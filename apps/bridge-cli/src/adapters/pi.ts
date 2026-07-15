import { createPiNormalizer } from "../normalize/pi";
import {
	buildPiGetAvailableModelsCommand,
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	normalizePiModelProviders,
} from "../normalize/pi-commands";
import {
	isRecord,
	type NormalizedEvent,
	userMessageEvent,
} from "../normalize/types";
import {
	type ApprovalRegistry,
	createApprovalRegistry,
	retractPendingApprovals,
} from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import { wirePiExtensionUiRequest } from "./pi-approvals";
import { makePiSetModel, makePiSetThinking } from "./pi-controls";
import { makePiSendWith } from "./pi-send-with";
import { makePiSessionReadyTracker, tryParseJson } from "./pi-session-ready";
import { makePiStatusTracker } from "./pi-status";
import { makePiStreamingTracker } from "./pi-streaming";
import { spawnProcessIo } from "./process-io";
import {
	createQuestionRegistry,
	type QuestionRegistry,
	retractPendingQuestions,
} from "./questions";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import {
	type Adapter,
	AGENT_EXITED_STATUS,
	type AgentHandle,
	type AgentImage,
} from "./types";

/** ASSUMPTION (unverified, no `pi` binary available in this sandbox): `pi`'s
 * RPC mode is invoked as `pi --mode rpc`, with the working directory set via
 * the spawned process's cwd (there's no documented command to set it
 * per-session, unlike codex's `thread/start` or opencode's `session/new`).
 * See the ASSUMPTION note in normalize/pi.ts for the protocol shapes. */
const PI_ARGS = ["--mode", "rpc"];

/** The shared plumbing `drainPiStdout` closes over — bundled into one object
 * so it stays under the repo's max-params gate. */
interface PiStdoutDeps {
	approvals: ApprovalRegistry;
	events: { push(event: NormalizedEvent): void };
	io: { lines: AsyncIterable<string>; writeLine(line: string): void };
	modelProviders: Record<string, string>;
	// R1-T2: the stateful normalizer — tracks tool-call name/duration across
	// lines (tool_execution_update's running preview, durationMs) — one
	// instance per session, so state doesn't leak across sessions.
	normalize: (raw: unknown) => NormalizedEvent[];
	// R3-T1 Part B: a `select` extension_ui_request's QuestionCard reply path.
	questions: QuestionRegistry;
	sessionReady: { onLine(raw: unknown): void };
	statusTracker: { onLine(raw: unknown): void };
	// R2-T3 item 1 (CRITICAL): tracks whether pi is mid-turn so `send()` can
	// decide whether the prompt frame needs `streamingBehavior: "followUp"`.
	streaming: { onLine(raw: unknown): void };
}

/** Consumes pi's stdout: feeds every parsed line to the session-ready +
 * status trackers, accumulates the modelId → provider map `setModel` needs,
 * routes `extension_ui_request` lines through the RC-T4 no-hang contract
 * (see pi-approvals.ts), and forwards each normalized event. Detached
 * (fire-and-forget) from `start` purely to keep it under the line gate. */
async function drainPiStdout(deps: PiStdoutDeps): Promise<void> {
	const {
		approvals,
		events,
		io,
		modelProviders,
		normalize,
		questions,
		sessionReady,
		statusTracker,
		streaming,
	} = deps;
	for await (const line of io.lines) {
		const raw = tryParseJson(line);
		sessionReady.onLine(raw);
		statusTracker.onLine(raw);
		streaming.onLine(raw);
		if (isRecord(raw)) {
			wirePiExtensionUiRequest(raw, { approvals, events, io, questions });
		}
		const nextProviders = normalizePiModelProviders(raw);
		if (nextProviders) {
			Object.assign(modelProviders, nextProviders);
		}
		for (const event of normalize(raw)) {
			events.push(event);
		}
	}
}

/** Forwards pi's stderr lines as error events. Detached from `start` for the
 * same reason as `drainPiStdout`. */
async function drainPiStderr(
	io: { stderrLines: AsyncIterable<string> },
	events: { push(event: NormalizedEvent): void }
): Promise<void> {
	for await (const line of io.stderrLines) {
		events.push({ kind: "error", message: line });
	}
}

/** The plumbing `buildPiAgentHandle` closes over — bundled into one object so
 * it stays under the repo's max-params gate. */
interface PiAgentHandleDeps {
	approvals: ApprovalRegistry;
	epoch: TurnEpochRef;
	events: AsyncQueue<NormalizedEvent>;
	io: {
		stop(): void;
		writeLine(line: string): void;
	};
	modelProviders: Record<string, string>;
	// R3-T1 Part B: a `select` extension_ui_request's QuestionCard reply path.
	questions: QuestionRegistry;
	statusTracker: { request(): void };
	// R2-T3 item 1 (CRITICAL): `send()` consults this to decide whether the
	// prompt frame needs `streamingBehavior: "followUp"` — see pi-streaming.ts.
	// R2-T3 review finding 2: `interrupt()`/`stop()` also call `reset()` on
	// this so an abort that never emits `agent_settled` can't leave it stuck.
	streaming: { isStreaming(): boolean; reset(): void };
}

// Cancels the in-flight turn without ending the session — the web Stop
// button. RC-T3: bumps the turn epoch so a stdout straggler is dropped as
// stale at the relay boundary. R2-T3 finding 2: force-resets `streaming`
// since pi's abort isn't guaranteed to emit agent_settled. R3-1 finding 1:
// also retracts pending extension_ui confirm/select cards (approvals/
// questions), exactly like codex/opencode's interrupt(), so a card can't
// survive into the next turn and a late answer can't land for an
// already-aborted request. Split out of `buildPiAgentHandle`'s object
// literal purely to keep that function under the max-lines-per-function gate.
function makePiInterrupt(deps: PiAgentHandleDeps): () => void {
	const { approvals, epoch, events, io, questions, streaming } = deps;
	return () => {
		bumpTurnEpoch(epoch);
		streaming.reset();
		retractPendingApprovals(approvals, events);
		retractPendingQuestions(questions, events);
		io.writeLine(JSON.stringify({ type: "abort" }));
	};
}

// Ends the session outright — closes the pi process and the event queue.
// R3-1 finding 1/3: retracts before close() — a push after close is a
// silent no-op (async-queue.ts), so the cancelled event must land first,
// mirroring codex.ts/opencode.ts's stop(). Split out for the same reason as
// `makePiInterrupt` above.
function makePiStop(deps: PiAgentHandleDeps): () => void {
	const { approvals, epoch, events, io, questions, streaming } = deps;
	return () => {
		bumpTurnEpoch(epoch);
		streaming.reset();
		retractPendingApprovals(approvals, events);
		retractPendingQuestions(questions, events);
		io.stop();
		events.close();
		approvals.clear();
		questions.clear();
	};
}

/** Builds the `AgentHandle` `start` returns. Extracted purely to keep `start`
 * itself under the line gate. */
function buildPiAgentHandle(deps: PiAgentHandleDeps): AgentHandle {
	const {
		approvals,
		epoch,
		events,
		io,
		modelProviders,
		questions,
		statusTracker,
		streaming,
	} = deps;
	return {
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		// R3-T1 Part B: the web's reply to a `select` request's QuestionCard.
		answerQuestion(requestId: string, answers: string[][]): void {
			questions.answer(requestId, answers);
		},
		events,
		getStatus: statusTracker.request,
		interrupt: makePiInterrupt(deps),
		send(text: string, images?: AgentImage[]): void {
			// A new turn begins — bump BEFORE pushing (see `interrupt` above).
			bumpTurnEpoch(epoch);
			events.push(userMessageEvent(text));
			// CRITICAL (R2-T3 item 1): a bare prompt sent mid-stream errors —
			// `followUp` is the always-safe, non-interrupting choice (`"steer"`
			// isn't sent by this adapter today; see buildPiPromptCommand's doc).
			// P3-T2: downloaded images ride the prompt frame's `images` field.
			io.writeLine(
				buildPiPromptCommand(
					text,
					streaming.isStreaming() ? "followUp" : undefined,
					images
				)
			);
		},
		sendWith: makePiSendWith({
			approvals,
			epoch,
			events,
			io,
			questions,
			streaming,
		}),
		setModel: makePiSetModel(io, events, modelProviders),
		setThinking: makePiSetThinking(io, events),
		stop: makePiStop(deps),
	};
}

/**
 * `pi --mode rpc` — Mario Zechner's `pi` coding agent's headless JSON-over-
 * stdio mode. Unlike codex/opencode/claude-code, pi has no per-tool-call
 * approval protocol at all — bash/tool calls run ungated (see the
 * `noApprovalGate` badge, agent-capabilities.ts). The approval registry here
 * is used for exactly one thing instead: RC-T4's `extension_ui_request`
 * `select`/`confirm` dialogs (see pi-approvals.ts) — anything else passed to
 * `answerApproval` (an unknown/stale id) emits the shared "unknown request"
 * status event.
 */
export const piAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("pi", PI_ARGS, dir);
		const epoch = createTurnEpoch();
		const events = turnStampingQueue(
			createAsyncQueue<NormalizedEvent>(),
			epoch
		);
		const approvals = createApprovalRegistry(events);
		// R3-T1 Part B: a `select` extension_ui_request's QuestionCard reply
		// path — parallel to `approvals`, cleared the same way on exit/stop.
		const questions = createQuestionRegistry(events);
		io.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
			questions.clear();
		});

		const sessionReady = makePiSessionReadyTracker(events);
		const statusTracker = makePiStatusTracker(io, events);
		const streaming = makePiStreamingTracker();
		// modelId → provider, accumulated from get_available_models, so setModel
		// can build set_model's required {provider, modelId} from a bare id.
		const modelProviders: Record<string, string> = {};
		drainPiStdout({
			approvals,
			events,
			io,
			modelProviders,
			normalize: createPiNormalizer(),
			questions,
			sessionReady,
			statusTracker,
			streaming,
		});
		drainPiStderr(io, events);

		// Fired off once, right at start — see the ASSUMPTION note on
		// `normalizePiCommandsResponse`/`normalizePiStateModel` in normalize/pi.ts
		// for the response shapes `sessionReady` parses out of whichever of
		// these comes back first.
		io.writeLine(buildPiGetStateCommand());
		io.writeLine(buildPiGetAvailableModelsCommand());
		io.writeLine(buildPiGetCommandsCommand());

		return buildPiAgentHandle({
			approvals,
			epoch,
			events,
			io,
			modelProviders,
			questions,
			statusTracker,
			streaming,
		});
	},
};
