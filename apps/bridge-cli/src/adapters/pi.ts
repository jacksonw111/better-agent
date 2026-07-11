import { createPiNormalizer } from "../normalize/pi";
import {
	buildPiGetAvailableModelsCommand,
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	normalizePiAvailableModels,
	normalizePiCommandsResponse,
	normalizePiModelProviders,
	normalizePiStateModel,
} from "../normalize/pi-commands";
import {
	isRecord,
	type NormalizedEvent,
	userMessageEvent,
} from "../normalize/types";
import { type ApprovalRegistry, createApprovalRegistry } from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import { wirePiExtensionUiRequest } from "./pi-approvals";
import { makePiSetModel, makePiSetThinking } from "./pi-controls";
import { makePiSendWith } from "./pi-send-with";
import { makePiStatusTracker } from "./pi-status";
import { makePiStreamingTracker } from "./pi-streaming";
import { spawnProcessIo } from "./process-io";
import { PI_SESSION_CAPABILITIES } from "./session-capabilities";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import { type Adapter, AGENT_EXITED_STATUS, type AgentHandle } from "./types";

/** ASSUMPTION (unverified, no `pi` binary available in this sandbox): `pi`'s
 * RPC mode is invoked as `pi --mode rpc`, with the working directory set via
 * the spawned process's cwd (there's no documented command to set it
 * per-session, unlike codex's `thread/start` or opencode's `session/new`).
 * See the ASSUMPTION note in normalize/pi.ts for the protocol shapes. */
const PI_ARGS = ["--mode", "rpc"];

function tryParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/**
 * Tracks the three pieces `session_ready` is assembled from — `get_state`'s
 * model, `get_available_models`' list, and `get_commands`' slash commands/skills
 * — and pushes exactly one `session_ready` event, the moment the commands list
 * is known (using whatever model/models have arrived by then, if any).
 */
function makePiSessionReadyTracker(events: {
	push(event: NormalizedEvent): void;
}): {
	onLine(raw: unknown): void;
} {
	let emitted = false;
	let model: string | undefined;
	let models: string[] | undefined;
	return {
		onLine(raw: unknown): void {
			const nextModel = normalizePiStateModel(raw);
			if (nextModel !== undefined) {
				model = nextModel;
			}
			const nextModels = normalizePiAvailableModels(raw);
			if (nextModels !== undefined) {
				models = nextModels;
			}
			if (emitted) {
				return;
			}
			const commands = normalizePiCommandsResponse(raw);
			if (!commands) {
				return;
			}
			emitted = true;
			events.push({
				kind: "status",
				status: "session_ready",
				detail: {
					model,
					models,
					...commands,
					capabilities: PI_SESSION_CAPABILITIES,
				},
			});
		},
	};
}

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
			wirePiExtensionUiRequest(raw, io, events, approvals);
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
	statusTracker: { request(): void };
	// R2-T3 item 1 (CRITICAL): `send()` consults this to decide whether the
	// prompt frame needs `streamingBehavior: "followUp"` — see pi-streaming.ts.
	// R2-T3 review finding 2: `interrupt()`/`stop()` also call `reset()` on
	// this so an abort that never emits `agent_settled` can't leave it stuck.
	streaming: { isStreaming(): boolean; reset(): void };
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
		statusTracker,
		streaming,
	} = deps;
	return {
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		events,
		getStatus: statusTracker.request,
		// Cancels the in-flight turn without ending the session — the web Stop
		// button. pi's stdio protocol supports an abort frame directly. RC-T3:
		// bumps the turn epoch so a straggler event still in flight on stdout
		// is dropped as stale at the relay-client boundary (turn-epoch.ts) —
		// pi has no per-tool-call approval protocol, so nothing to retract.
		interrupt(): void {
			bumpTurnEpoch(epoch);
			// R2-T3 review finding 2: pi's abort path isn't guaranteed to emit
			// agent_settled, so the tracker is force-reset here rather than left
			// to observe its own end-of-turn line — otherwise a send right after
			// an interrupt would be wrongly tagged followUp forever.
			streaming.reset();
			io.writeLine(JSON.stringify({ type: "abort" }));
		},
		send(text: string): void {
			// A new turn begins — bump BEFORE pushing (see `interrupt` above).
			bumpTurnEpoch(epoch);
			events.push(userMessageEvent(text));
			// CRITICAL (R2-T3 item 1): a bare prompt sent while pi is still
			// streaming a turn errors — `followUp` is the always-safe,
			// non-interrupting choice for a send that lands mid-turn (`"steer"`
			// isn't sent by this adapter today, see buildPiPromptCommand's doc).
			io.writeLine(
				buildPiPromptCommand(
					text,
					streaming.isStreaming() ? "followUp" : undefined
				)
			);
		},
		sendWith: makePiSendWith({ epoch, events, io, streaming }),
		setModel: makePiSetModel(io, events, modelProviders),
		setThinking: makePiSetThinking(io, events),
		stop(): void {
			bumpTurnEpoch(epoch);
			streaming.reset();
			io.stop();
			events.close();
			approvals.clear();
		},
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
		io.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
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
			statusTracker,
			streaming,
		});
	},
};
