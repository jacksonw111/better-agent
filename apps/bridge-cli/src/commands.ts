// Parses one relayed command's `data` (`unknown` on the wire) into either a
// plain-text send or an answer to a previously-emitted `ApprovalEvent`, and
// dispatches it to a `CommandSink` — split out of relay-client.ts to keep
// that file under the project's file-size limit.

import { dispatchControlCommand } from "./command-dispatch";
import { isRecord } from "./normalize/types";

/** One relayed command/event; mirrors `RelayEvent` from `@better-agent/agent/ports`. */
export interface RelayEvent {
	data: unknown;
	id: number;
}

/** A plain-text command to feed to the agent via `send`. */
export interface TextCommand {
	text: string;
	type: "text";
}

/** The user's answer to a previously-emitted `ApprovalEvent`, to feed to the
 * agent via `answerApproval`. */
export interface ApprovalCommand {
	optionId: string;
	requestId: string;
	type: "approval";
}

/** A server-initiated request to end this session right now — the web UI's
 * "End session" action (see `packages/api/src/routers/bridge.ts`'s
 * `endSession`), relayed as a control command instead of a plain text one so
 * the CLI can tell "stop the agent" apart from "send it this text". */
export interface ControlStopCommand {
	action: "stop";
	type: "control";
}

/** The Local Agent detail page's Stop/Interrupt button — cancels the
 * in-flight turn but, unlike `ControlStopCommand`, leaves the session (and
 * the underlying agent process) alive so the user can keep chatting. Routed
 * to `CommandSink.interrupt`. */
export interface ControlInterruptCommand {
	action: "interrupt";
	type: "control";
}

/** The Local Agent detail page's model picker. Routed to
 * `CommandSink.setModel`. */
export interface ControlSetModelCommand {
	action: "setModel";
	model: string;
	type: "control";
}

/** The Local Agent detail page's permission-mode dropdown. Routed to
 * `CommandSink.setPermissionMode`. */
export interface ControlSetPermissionModeCommand {
	action: "setPermissionMode";
	mode: string;
	type: "control";
}

/** The Local Agent detail page's thinking-effort dropdown (R2-T3 item 2 —
 * pi's `set_thinking_level`). Routed to `CommandSink.setThinking`. */
export interface ControlSetThinkingCommand {
	action: "setThinking";
	level: string;
	type: "control";
}

/** The Local Agent detail page's "Past conversations" button — requests the
 * agent's local session list (e.g. claude's `listSessions({dir})`). Routed to
 * `CommandSink.listSessions`; the adapter answers asynchronously by pushing a
 * `session_list` status event, not a direct return value. */
export interface ControlListSessionsCommand {
	action: "listSessions";
	type: "control";
}

/** The Local Agent detail page's status refresh — asks the agent for a
 * normalized status snapshot (context usage, cost/tokens, MCP servers,
 * running/idle). Routed to `CommandSink.getStatus`; like `listSessions`,
 * fire-and-forget — the adapter answers by PUSHING a `status_snapshot`
 * status event, never a direct return value. */
export interface ControlGetStatusCommand {
	action: "getStatus";
	type: "control";
}

/** A server-initiated request to reconfigure and relaunch the agent IN
 * PLACE (see `RESTART_CONTROL_COMMAND` in
 * `packages/api/src/routers/bridge-restart.ts`). Unlike `ControlStopCommand`,
 * this must NOT end the bridge session — `restart-loop.ts` tears down the
 * current agent process, re-fetches fresh config, and starts a new one under
 * the SAME bridge sessionId; the process itself never exits. */
export interface ControlRestartCommand {
	action: "restart";
	type: "control";
}

export type ControlCommand =
	| ControlGetStatusCommand
	| ControlInterruptCommand
	| ControlListSessionsCommand
	| ControlRestartCommand
	| ControlSetModelCommand
	| ControlSetPermissionModeCommand
	| ControlSetThinkingCommand
	| ControlStopCommand;

export type ParsedCommand = ApprovalCommand | ControlCommand | TextCommand;

function isApprovalCommand(data: unknown): data is ApprovalCommand {
	return (
		isRecord(data) &&
		data.type === "approval" &&
		typeof data.requestId === "string" &&
		typeof data.optionId === "string"
	);
}

/** The control actions that carry a required string payload — split out of
 * `parseControlCommand` purely to keep its complexity under the repo's
 * eslint gate (each added action's `&&` check counts against it). */
function parseControlCommandWithPayload(
	data: Record<string, unknown>
): ControlCommand | null {
	if (data.action === "setModel" && typeof data.model === "string") {
		return { action: "setModel", model: data.model, type: "control" };
	}
	if (data.action === "setPermissionMode" && typeof data.mode === "string") {
		return { action: "setPermissionMode", mode: data.mode, type: "control" };
	}
	if (data.action === "setThinking" && typeof data.level === "string") {
		return { action: "setThinking", level: data.level, type: "control" };
	}
	return null;
}

/** The control actions with no payload at all — see
 * `parseControlCommandWithPayload` for why this is split out. */
function parseSimpleControlCommand(
	data: Record<string, unknown>
): ControlCommand | null {
	if (data.action === "stop") {
		return { action: "stop", type: "control" };
	}
	if (data.action === "interrupt") {
		return { action: "interrupt", type: "control" };
	}
	if (data.action === "listSessions") {
		return { action: "listSessions", type: "control" };
	}
	if (data.action === "getStatus") {
		return { action: "getStatus", type: "control" };
	}
	if (data.action === "restart") {
		return { action: "restart", type: "control" };
	}
	return null;
}

/** Parses a `{ type: "control", ... }` record's `action` (and any
 * action-specific payload) into a `ControlCommand`, or `null` for an
 * unrecognized action or a malformed payload (e.g. `setModel` missing its
 * `model` string). */
function parseControlCommand(
	data: Record<string, unknown>
): ControlCommand | null {
	return (
		parseControlCommandWithPayload(data) ?? parseSimpleControlCommand(data)
	);
}

/**
 * Parses one relayed command's `data` (`unknown` on the wire) into a text
 * send, an approval answer, or a control command. Accepts a bare string or
 * `{ text }` (a plain-text command), `{ type: "approval", requestId,
 * optionId }` (the web UI's reply to an `ApprovalEvent`), and `{ type:
 * "control", action: "stop" | "interrupt" | "setModel" |
 * "setPermissionMode" | "setThinking" | "listSessions" | "getStatus" |
 * "restart", ... }` (session controls); anything else is `null` and left
 * undispatched.
 */
export function parseCommandText(data: unknown): ParsedCommand | null {
	if (typeof data === "string") {
		return { text: data, type: "text" };
	}
	if (isApprovalCommand(data)) {
		return data;
	}
	if (isRecord(data) && data.type === "control") {
		return parseControlCommand(data);
	}
	if (isRecord(data) && typeof data.text === "string") {
		return { text: data.text, type: "text" };
	}
	return null;
}

/** Mutable so pollLoop can resume from the last seen id after a reconnect. */
export interface AfterIdRef {
	current: number;
}

/** The subset of `AgentHandle` `pollLoop` needs to dispatch a command — a
 * text send, an answer to a pending approval, or (optionally — most fakes in
 * tests only exercise send/answerApproval) a request to stop the agent, or
 * one of the Local Agent detail page's session controls. All four control
 * methods are optional: not every adapter supports them (see
 * `AgentHandle` in `apps/bridge-cli/src/adapters/types.ts`), and a command
 * routed to one an adapter doesn't implement is silently a no-op rather than
 * a crash. */
export interface CommandSink {
	answerApproval(requestId: string, optionId: string): void;
	/** Asks the agent for a normalized status snapshot; the adapter answers by
	 * pushing a `status_snapshot` status event (see
	 * `apps/bridge-cli/src/adapters/types.ts`'s `StatusSnapshotDetail`). Called
	 * for a `control: getStatus` command — the detail page's status line. */
	getStatus?(): void;
	/** Cancels the in-flight turn but leaves the session alive. Called for a
	 * `control: interrupt` command — the detail page's Stop/Interrupt
	 * button. */
	interrupt?(): void;
	/** Fetches and pushes the agent's past local conversations. Called for a
	 * `control: listSessions` command — the detail page's "Past
	 * conversations" button. */
	listSessions?(): void;
	send(text: string): void;
	/** Changes the model used for subsequent turns. Called for a
	 * `control: setModel` command. */
	setModel?(model: string): void;
	/** Changes the session's permission mode. Called for a
	 * `control: setPermissionMode` command. */
	setPermissionMode?(mode: string): void;
	/** Changes the extended-thinking/reasoning effort level. Called for a
	 * `control: setThinking` command (R2-T3 item 2 — pi's
	 * `set_thinking_level`). */
	setThinking?(level: string): void;
	/** Stops the agent process. Called for a `control: stop` command; see
	 * `AgentHandle.stop` in `apps/bridge-cli/src/adapters/types.ts`, which the
	 * real sink (the running session's `handle`) always implements. */
	stop?(): void;
}

/** What `dispatchCommands` did with a batch of relayed commands. */
export interface DispatchResult {
	/** A `control: restart` command was seen — the caller (`pollLoop`) should
	 * end with a "restart" `PollOutcome` instead of "stopped", so the outer
	 * restart loop relaunches the agent instead of exiting the process.
	 * Tracked independently of `stopRequested`, not merged into it. */
	restartRequested: boolean;
	/** A `control: stop` command was seen — the caller (`pollLoop`) should
	 * stop polling and wind the session down instead of scheduling another
	 * poll. */
	stopRequested: boolean;
	/** Whether any commands were seen at all (used by `pollLoop` to decide
	 * whether to speed back up or keep backing off). */
	wasActive: boolean;
}

/** Parses and dispatches each command to `sink` — a text command calls
 * `sink.send`, an approval command calls `sink.answerApproval`, a control
 * command calls the matching `sink.stop`/`interrupt`/`setModel`/
 * `setPermissionMode` (nothing, for `restart` — see `dispatchControlCommand`)
 * — advancing `afterIdRef` past every command seen either way. */
export function dispatchCommands(
	commands: RelayEvent[],
	sink: CommandSink,
	afterIdRef: AfterIdRef
): DispatchResult {
	let stopRequested = false;
	let restartRequested = false;
	for (const command of commands) {
		const parsed = parseCommandText(command.data);
		if (parsed?.type === "text") {
			sink.send(parsed.text);
		} else if (parsed?.type === "approval") {
			sink.answerApproval(parsed.requestId, parsed.optionId);
		} else if (parsed?.type === "control") {
			dispatchControlCommand(parsed, sink);
			stopRequested = stopRequested || parsed.action === "stop";
			restartRequested = restartRequested || parsed.action === "restart";
		}
		afterIdRef.current = command.id;
	}
	return { restartRequested, stopRequested, wasActive: commands.length > 0 };
}
