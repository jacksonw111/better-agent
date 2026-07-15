// Control-command types + parsing, split out of commands.ts (which sits at the
// repo's 300-line-per-file cap). A `{ type: "control", action, ... }` record on
// the relay `commands` channel is parsed here into a typed `ControlCommand`;
// command-dispatch.ts routes each to the matching CommandSink method.

import { type GitControlCommand, parseGitControlCommand } from "./commands-git";
import {
	type ControlAnswerQuestionCommand,
	parseAnswerQuestionCommand,
} from "./commands-question";
import { isRecord } from "./normalize/types";

/** A server-initiated request to end this session right now — the web UI's
 * "End session" action, relayed as a control command so the CLI can tell "stop
 * the agent" apart from "send it this text". */
export interface ControlStopCommand {
	action: "stop";
	type: "control";
}

/** The detail page's Stop/Interrupt button — cancels the in-flight turn but
 * leaves the session alive. Routed to `CommandSink.interrupt`. */
export interface ControlInterruptCommand {
	action: "interrupt";
	type: "control";
}

/** The detail page's model picker. Routed to `CommandSink.setModel`. */
export interface ControlSetModelCommand {
	action: "setModel";
	model: string;
	type: "control";
}

/** The detail page's permission-mode dropdown. Routed to
 * `CommandSink.setPermissionMode`. */
export interface ControlSetPermissionModeCommand {
	action: "setPermissionMode";
	mode: string;
	type: "control";
}

/** The detail page's thinking-effort dropdown. Routed to
 * `CommandSink.setThinking`. */
export interface ControlSetThinkingCommand {
	action: "setThinking";
	level: string;
	type: "control";
}

/** The detail page's "Past conversations" button. Routed to
 * `CommandSink.listSessions` (the adapter answers by pushing a status event). */
export interface ControlListSessionsCommand {
	action: "listSessions";
	type: "control";
}

/** The detail page's status refresh. Routed to `CommandSink.getStatus`
 * (fire-and-forget; the adapter pushes a `status_snapshot` status event). */
export interface ControlGetStatusCommand {
	action: "getStatus";
	type: "control";
}

/** A server-initiated request to reconfigure and relaunch the agent IN PLACE.
 * Unlike `ControlStopCommand`, must NOT end the bridge session. */
export interface ControlRestartCommand {
	action: "restart";
	type: "control";
}

/** P4-T2: the workspace Shell tab's one-shot command runner. Routed to
 * `CommandSink.runShell` — a CLI-GLOBAL wrapper (shell-runner.ts) that spawns
 * `sh -c command` in the agent's workspace and streams its output back as
 * `runShell`-marked tool events. Does NOT touch the agent. */
export interface ControlRunShellCommand {
	action: "runShell";
	command: string;
	type: "control";
}

/** P4-T3: the workspace Files tab's directory listing. `requestId` is minted
 * by the WEB and echoed back on the `fs_list` reply status event so the web
 * can correlate it (unlike fire-and-forget `listSessions`). `path` is
 * workspace-relative; absent means the workspace root. Routed to
 * `CommandSink.fsList` — a CLI-GLOBAL wrapper (fs-reader.ts), agent-free. */
export interface ControlFsListCommand {
	action: "fsList";
	path?: string;
	requestId: string;
	type: "control";
}

/** P4-T3: the Files tab's file preview / @file picker read. Same requestId
 * correlation as `ControlFsListCommand`; the reply arrives as one or more
 * chunked `fs_read` status events. Routed to `CommandSink.fsRead`. */
export interface ControlFsReadCommand {
	action: "fsRead";
	path: string;
	requestId: string;
	type: "control";
}

/** P4-T5: the ⌘K palette's cross-session content search. `requestId` is
 * web-minted and echoed on the single `session_search` reply status event
 * (see adapters/session-search.ts). Routed to `CommandSink.searchSessions` —
 * answered by the ADAPTER's own on-disk session store (per-agent-kind),
 * unlike the CLI-global fs/git wrappers. */
export interface ControlSearchSessionsCommand {
	action: "searchSessions";
	query: string;
	requestId: string;
	type: "control";
}

/** The detail page's "Start desktop" button (`--cua`): provision + boot the
 * local VM and open its VNC. Routed to `CommandSink.startVm`. */
export interface ControlStartVmCommand {
	action: "startVm";
	type: "control";
}

/** The detail page's "Stop desktop" button (`--cua`): tear the VNC relay down
 * and stop the VM. Routed to `CommandSink.stopVm`. */
export interface ControlStopVmCommand {
	action: "stopVm";
	type: "control";
}

export type ControlCommand =
	| ControlAnswerQuestionCommand
	| ControlFsListCommand
	| ControlFsReadCommand
	| GitControlCommand
	| ControlGetStatusCommand
	| ControlInterruptCommand
	| ControlListSessionsCommand
	| ControlRestartCommand
	| ControlRunShellCommand
	| ControlSearchSessionsCommand
	| ControlSetModelCommand
	| ControlSetPermissionModeCommand
	| ControlSetThinkingCommand
	| ControlStartVmCommand
	| ControlStopCommand
	| ControlStopVmCommand;

/** The control actions carrying a required string payload — split out to keep
 * `parseControlCommand`'s complexity under the eslint gate. */
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
	if (data.action === "runShell" && typeof data.command === "string") {
		return { action: "runShell", command: data.command, type: "control" };
	}
	return null;
}

/** P4-T3: the fs actions, split from `parseControlCommandWithPayload` to keep
 * that function's complexity under the eslint gate. Both require the
 * web-minted string `requestId`; `fsList`'s `path` is optional (root),
 * `fsRead`'s is required. */
function parseFsControlCommand(
	data: Record<string, unknown>
): ControlCommand | null {
	if (typeof data.requestId !== "string") {
		return null;
	}
	const path = typeof data.path === "string" ? data.path : undefined;
	if (data.action === "fsList") {
		return {
			action: "fsList",
			path,
			requestId: data.requestId,
			type: "control",
		};
	}
	if (data.action === "fsRead" && path !== undefined) {
		return {
			action: "fsRead",
			path,
			requestId: data.requestId,
			type: "control",
		};
	}
	return null;
}

/** P4-T5: `searchSessions` — requires the web-minted `requestId` (echoed on
 * the reply, like the fs/git commands) and the literal `query` string. */
function parseSearchSessionsCommand(
	data: Record<string, unknown>
): ControlCommand | null {
	if (
		data.action === "searchSessions" &&
		typeof data.requestId === "string" &&
		typeof data.query === "string"
	) {
		return {
			action: "searchSessions",
			query: data.query,
			requestId: data.requestId,
			type: "control",
		};
	}
	return null;
}

const SIMPLE_CONTROL_ACTIONS = new Set([
	"stop",
	"interrupt",
	"listSessions",
	"getStatus",
	"restart",
	"startVm",
	"stopVm",
]);

/** The control actions with no payload at all. */
function parseSimpleControlCommand(
	data: Record<string, unknown>
): ControlCommand | null {
	if (
		typeof data.action === "string" &&
		SIMPLE_CONTROL_ACTIONS.has(data.action)
	) {
		return { action: data.action, type: "control" } as ControlCommand;
	}
	return null;
}

/** Parses a `{ type: "control", ... }` record's `action` (and any payload) into
 * a `ControlCommand`, or `null` for an unrecognized action / malformed payload. */
export function parseControlCommand(
	data: Record<string, unknown>
): ControlCommand | null {
	return (
		parseControlCommandWithPayload(data) ??
		parseFsControlCommand(data) ??
		parseGitControlCommand(data) ??
		parseSearchSessionsCommand(data) ??
		parseAnswerQuestionCommand(data) ??
		parseSimpleControlCommand(data)
	);
}

export function isControlRecord(
	data: unknown
): data is Record<string, unknown> {
	return isRecord(data) && data.type === "control";
}
