import { selectAdapter } from "../adapters";
import type { Adapter, AgentHandle, AgentKind } from "../adapters/types";
import type { BridgeCliArgs } from "../args";
import { dispatchTextCommand } from "../command-dispatch";
import type { MessageEvent, StatusEvent } from "../normalize/types";
import { createOobSender, type OobSender } from "../oob-push";
import type { RelayTransport } from "../relay-client";
import { createRelayTransport } from "../relay-transport";
import { type RunRestartLoopOptions, runRestartLoop } from "../restart-loop";
import type {
	RunSessionRequest,
	RunSessionSupplier,
	StartedRunSession,
} from "./launch-handler";

export type {
	RunSessionRequest,
	RunSessionSupplier,
	StartedRunSession,
} from "./launch-handler";

// S25-T1 (master spec §9.3): one Run's runtime + relay, as a reuse wrapper
// around the EXISTING session path — the same startSession → adapter.start →
// restart-loop sequence index.ts's session mode drives, with three
// task-specific twists: the pre-issued sessionCredential is the token, the
// startSession carries the runId (S2-T2's two-way Run ↔ session binding),
// and the Task Start Context is injected as the first user input through the
// SAME dispatch path web text commands take (`dispatchTextCommand`), echoed
// to the relay as an origin-tagged user message so the web can fold it.
// P2 (session resume): a `resumeAgentSessionId` rides the runtime's native
// resume path instead — same `StartOptions.resume` the session mode's
// `--resume` flag threads — and skips the injection entirely.

/** Injectable seams for tests; production uses the real modules. */
export interface RunSessionDeps {
	createTransport(config: { serverUrl: string; token: string }): RelayTransport;
	runLoop(options: RunRestartLoopOptions): Promise<void>;
	selectAdapter(agentKind: AgentKind): Adapter;
}

const TASK_LABEL_ID_LENGTH = 8;

/** P2: which runtimes honor `StartOptions.resume` — claude-code threads it to
 * the SDK's `resume` option, codex tries `thread/resume` (with its OWN visible
 * fresh-thread fallback, see codex.ts). opencode (both transports) and pi
 * ignore the option entirely, so a resume launch for them cold-starts with a
 * visible `resume_failed` notice instead of pretending to restore anything. */
const RESUME_SUPPORT: Record<AgentKind, boolean> = {
	"claude-code": true,
	codex: true,
	opencode: false,
	pi: false,
};

function defaultDeps(): RunSessionDeps {
	return {
		createTransport: createRelayTransport,
		runLoop: runRestartLoop,
		selectAdapter: (agentKind) => selectAdapter(agentKind),
	};
}

/** The restart loop consumes the session mode's full flag shape; a task run
 * is that shape with the managed workspace as `dir`, the Run credential as
 * `token`, and every interactive extra (CUA, debug) off. `resume` carries the
 * P2 resume id (when the runtime supports one) so an in-place relaunch before
 * the first captured `session_ready` still resumes the SAME conversation. */
function toSessionArgs(
	request: RunSessionRequest,
	serverUrl: string,
	label: string,
	resume: string | undefined
): BridgeCliArgs {
	return {
		agentKind: request.agentKind,
		cua: false,
		cuaImage: undefined,
		cuaVm: undefined,
		cuaVncUrl: undefined,
		debug: false,
		dir: request.workspacePath,
		label,
		opencodeTransport: "acp",
		resume,
		serverUrl,
		token: request.sessionCredential,
	};
}

/** A1: ONE reliable out-of-band sender for the whole Run session — used for
 * the launch-time pushes (start-context echo, resume_failed notice), then
 * handed to the restart loop so every later out-of-band site shares the same
 * epoch/sequence and the loop's final close() flushes these too. */
function sessionOobSender(
	transport: RelayTransport,
	sessionId: string
): OobSender {
	return createOobSender({
		pushEvents: (input) => transport.pushEvents(input),
		sessionId,
	});
}

/** First input injection: echo an origin-tagged user message to the relay
 * (A1: through the session's reliable out-of-band channel — this echo IS the
 * Run's first user message in history, so losing it to a relay hiccup left a
 * hole at the very top of the feed; delivery failure still never fails the
 * launch, the sender just retries and warns) and dispatch the context to the
 * agent exactly like a relayed web text command. */
function injectStartContext(
	oob: OobSender,
	handle: AgentHandle,
	startContext: string
): void {
	const echo: MessageEvent = {
		kind: "message",
		origin: "task-start",
		role: "user",
		text: startContext,
	};
	oob.push("taskstart", echo);
	// The narrow CommandSink view of the raw handle: the injected context is
	// text-only, so the image layer's ImageRef→AgentImage download never
	// applies — a plain `send(text)` is exactly what the web path dispatches.
	dispatchTextCommand(
		{
			answerApproval: (requestId, optionId) =>
				handle.answerApproval(requestId, optionId),
			send: (text) => handle.send(text),
		},
		startContext
	);
}

/** P2: a resume launch on a runtime that cannot resume never fails the launch
 * — the run cold-starts in the same workspace, and this best-effort notice
 * (the SAME `resume_failed` status the web already renders as its
 * lost-context warning, see status-line.tsx) tells the user honestly that the
 * prior conversation's context is gone. */
function pushResumeUnsupported(oob: OobSender, agentKind: AgentKind): void {
	const notice: StatusEvent = {
		detail: {
			reason: `${agentKind} cannot resume a prior conversation; started a fresh session in the same workspace`,
		},
		kind: "status",
		status: "resume_failed",
	};
	oob.push("taskstart", notice);
}

/**
 * Builds the production `RunSessionSupplier` (D4's relay reuse): resolves
 * with a started session whose `done` settles when the loops end — a
 * startup failure (revoked credential, missing binary, spawn error) rejects
 * the supplier call itself with the real error.
 */
export function createRunSessionSupplier(
	config: { serverUrl: string },
	deps: RunSessionDeps = defaultDeps()
): RunSessionSupplier {
	return async (request): Promise<StartedRunSession> => {
		const adapter = deps.selectAdapter(request.agentKind);
		const transport = deps.createTransport({
			serverUrl: config.serverUrl,
			token: request.sessionCredential,
		});
		const label = `task:${request.taskId.slice(0, TASK_LABEL_ID_LENGTH)}`;
		const {
			sessionId,
			config: startConfig,
			mcpServers,
			skills,
		} = await transport.startSession({
			agentKind: request.agentKind,
			label,
			runId: request.runId,
		});
		// P2: the runtime's native resume — only for runtimes that honor it; an
		// unsupported one cold-starts (never fails) with an honest notice.
		const resume = RESUME_SUPPORT[request.agentKind]
			? request.resumeAgentSessionId
			: undefined;
		const handle = await adapter.start(request.workspacePath, {
			config: startConfig ?? undefined,
			mcpServers,
			resume,
			skills,
		});
		const oob = sessionOobSender(transport, sessionId);
		if (request.resumeAgentSessionId && !resume) {
			pushResumeUnsupported(oob, request.agentKind);
		}
		// P2: only a cold start with a real context injects it — a resumed
		// conversation already has its history, and an empty context (empty
		// description) must never become an empty first message.
		if (!request.resumeAgentSessionId && request.startContext !== "") {
			injectStartContext(oob, handle, request.startContext);
		}
		const done = deps.runLoop({
			adapter,
			args: toSessionArgs(request, config.serverUrl, label, resume),
			handle,
			oobSender: oob,
			sessionId,
			signal: request.signal,
			transport,
		});
		return { done };
	};
}
