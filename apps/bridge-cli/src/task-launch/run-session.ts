import { selectAdapter } from "../adapters";
import type { Adapter, AgentHandle, AgentKind } from "../adapters/types";
import type { BridgeCliArgs } from "../args";
import { dispatchTextCommand } from "../command-dispatch";
import type { MessageEvent } from "../normalize/types";
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

/** Injectable seams for tests; production uses the real modules. */
export interface RunSessionDeps {
	createTransport(config: { serverUrl: string; token: string }): RelayTransport;
	runLoop(options: RunRestartLoopOptions): Promise<void>;
	selectAdapter(agentKind: AgentKind): Adapter;
}

const TASK_LABEL_ID_LENGTH = 8;

function defaultDeps(): RunSessionDeps {
	return {
		createTransport: createRelayTransport,
		runLoop: runRestartLoop,
		selectAdapter: (agentKind) => selectAdapter(agentKind),
	};
}

/** The restart loop consumes the session mode's full flag shape; a task run
 * is that shape with the managed workspace as `dir`, the Run credential as
 * `token`, and every interactive extra (CUA, debug, resume) off. */
function toSessionArgs(
	request: RunSessionRequest,
	serverUrl: string,
	label: string
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
		resume: undefined,
		serverUrl,
		token: request.sessionCredential,
	};
}

/** First input injection: echo an origin-tagged user message to the relay
 * (best-effort — cosmetic history, never a launch failure) and dispatch the
 * context to the agent exactly like a relayed web text command. */
function injectStartContext(
	transport: RelayTransport,
	sessionId: string,
	handle: AgentHandle,
	startContext: string
): void {
	const echo: MessageEvent = {
		kind: "message",
		origin: "task-start",
		role: "user",
		text: startContext,
	};
	transport.pushEvents({ events: [echo], sessionId }).catch(() => undefined);
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
		const handle = await adapter.start(request.workspacePath, {
			config: startConfig ?? undefined,
			mcpServers,
			skills,
		});
		injectStartContext(transport, sessionId, handle, request.startContext);
		const done = deps.runLoop({
			adapter,
			args: toSessionArgs(request, config.serverUrl, label),
			handle,
			sessionId,
			signal: request.signal,
			transport,
		});
		return { done };
	};
}
