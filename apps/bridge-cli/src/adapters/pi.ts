import { normalizePi } from "../normalize/pi";
import {
	buildPiGetAvailableModelsCommand,
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	buildPiSetModelCommand,
	normalizePiAvailableModels,
	normalizePiCommandsResponse,
	normalizePiModelProviders,
	normalizePiStateModel,
} from "../normalize/pi-commands";
import {
	buildPiGetSessionStatsCommand,
	normalizePiSessionStats,
	normalizePiStateRunning,
	type PiSessionStats,
} from "../normalize/pi-status";
import { type NormalizedEvent, userMessageEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { spawnProcessIo } from "./process-io";
import {
	type Adapter,
	AGENT_EXITED_STATUS,
	type AgentHandle,
	STATUS_SNAPSHOT_STATUS,
} from "./types";

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

/** Resolves the `{provider, modelId}` pi's `set_model` needs from the bare id
 * the web menu sends: a `provider/id` string splits directly; otherwise the
 * provider is looked up in the model→provider map built from
 * `get_available_models`. `null` when the provider can't be resolved. */
function resolvePiSetModel(
	model: string,
	providers: Record<string, string>
): { modelId: string; provider: string } | null {
	const slash = model.indexOf("/");
	if (slash > 0) {
		return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
	}
	const provider = providers[model];
	return provider ? { provider, modelId: model } : null;
}

/** The `setModel` control: resolves the provider for the chosen id, then writes
 * pi's `{provider, modelId}` set_model frame — or an error event if the
 * provider is unknown. Extracted so `start` stays under the line gate. */
function makePiSetModel(
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void },
	modelProviders: Record<string, string>
): (model: string) => void {
	return (model: string) => {
		const resolved = resolvePiSetModel(model, modelProviders);
		if (resolved) {
			io.writeLine(buildPiSetModelCommand(resolved.provider, resolved.modelId));
		} else {
			events.push({
				kind: "error",
				message: `pi setModel: unknown provider for model "${model}"`,
			});
		}
	};
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
				detail: { model, models, ...commands },
			});
		},
	};
}

/**
 * Tracks one in-flight `getStatus` request the way `makePiSessionReadyTracker`
 * tracks session_ready's pieces: `request()` fires the `get_session_stats` +
 * `get_state` frames, `onLine` collects both replies, and ONE
 * `status_snapshot` event is pushed the moment both have arrived (a new
 * `request()` before then simply re-arms with fresh frames). pi has no
 * request ids, so replies are matched by command name — see the ASSUMPTION
 * notes in normalize/pi-status.ts for the response shapes.
 */
function makePiStatusTracker(
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void }
): { onLine(raw: unknown): void; request(): void } {
	let pending = false;
	let stats: PiSessionStats | undefined;
	let state: { model?: string; running?: boolean } | undefined;
	return {
		request(): void {
			pending = true;
			stats = undefined;
			state = undefined;
			io.writeLine(buildPiGetSessionStatsCommand());
			io.writeLine(buildPiGetStateCommand());
		},
		onLine(raw: unknown): void {
			if (!pending) {
				return;
			}
			stats = normalizePiSessionStats(raw) ?? stats;
			const running = normalizePiStateRunning(raw);
			if (running !== undefined) {
				state = { model: normalizePiStateModel(raw), running };
			}
			if (stats && state) {
				pending = false;
				events.push({
					kind: "status",
					status: STATUS_SNAPSHOT_STATUS,
					detail: { model: state.model, running: state.running, ...stats },
				});
			}
		},
	};
}

/** Consumes pi's stdout: feeds every parsed line to the session-ready +
 * status trackers, accumulates the modelId → provider map `setModel` needs,
 * and forwards each normalized event. Detached (fire-and-forget) from
 * `start` purely to keep it under the line gate. */
async function drainPiStdout(
	io: { lines: AsyncIterable<string> },
	events: { push(event: NormalizedEvent): void },
	sessionReady: { onLine(raw: unknown): void },
	statusTracker: { onLine(raw: unknown): void },
	modelProviders: Record<string, string>
): Promise<void> {
	for await (const line of io.lines) {
		const raw = tryParseJson(line);
		sessionReady.onLine(raw);
		statusTracker.onLine(raw);
		const nextProviders = normalizePiModelProviders(raw);
		if (nextProviders) {
			Object.assign(modelProviders, nextProviders);
		}
		for (const event of normalizePi(raw)) {
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

/**
 * `pi --mode rpc` — Mario Zechner's `pi` coding agent's headless JSON-over-
 * stdio mode. Unlike codex/opencode/claude-code, pi has no per-tool-call
 * approval protocol at all (see normalize/pi.ts), so `answerApproval` is
 * wired to an approval registry that never has anything registered — any
 * call to it always emits the shared "unknown request" status event.
 */
export const piAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const io = await spawnProcessIo("pi", PI_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();
		const approvals = createApprovalRegistry(events);
		io.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

		const sessionReady = makePiSessionReadyTracker(events);
		const statusTracker = makePiStatusTracker(io, events);
		// modelId → provider, accumulated from get_available_models, so setModel
		// can build set_model's required {provider, modelId} from a bare id.
		const modelProviders: Record<string, string> = {};
		drainPiStdout(io, events, sessionReady, statusTracker, modelProviders);
		drainPiStderr(io, events);

		// Fired off once, right at start — see the ASSUMPTION note on
		// `normalizePiCommandsResponse`/`normalizePiStateModel` in normalize/pi.ts
		// for the response shapes `sessionReady` parses out of whichever of
		// these comes back first.
		io.writeLine(buildPiGetStateCommand());
		io.writeLine(buildPiGetAvailableModelsCommand());
		io.writeLine(buildPiGetCommandsCommand());

		return {
			answerApproval(requestId: string, optionId: string): void {
				approvals.answer(requestId, optionId);
			},
			events,
			getStatus: statusTracker.request,
			send(text: string): void {
				events.push(userMessageEvent(text));
				io.writeLine(buildPiPromptCommand(text));
			},
			setModel: makePiSetModel(io, events, modelProviders),
			stop(): void {
				io.stop();
				events.close();
				approvals.clear();
			},
		};
	},
};
