// `dispatchControlCommand` + its per-action call helpers, split out of
// commands.ts purely to keep that file under the repo's 300-line limit (that
// file already sat at the cap before R2-T3 item 2's `setThinking` control
// needed a new branch here).

import type { CommandSink, ControlCommand } from "./commands";

// Each of these one-liners exists purely so `dispatchControlCommand`'s own
// branching doesn't also carry the optional-chaining call itself — eslint's
// `complexity` rule counts each `?.` same as a branch, and the two together
// on one line push that function's count above the repo's gate.
function callStop(sink: CommandSink): void {
	sink.stop?.();
}
function callInterrupt(sink: CommandSink): void {
	sink.interrupt?.();
}
function callSetModel(sink: CommandSink, model: string): void {
	sink.setModel?.(model);
}
function callSetPermissionMode(sink: CommandSink, mode: string): void {
	sink.setPermissionMode?.(mode);
}
function callSetThinking(sink: CommandSink, level: string): void {
	sink.setThinking?.(level);
}
function callListSessions(sink: CommandSink): void {
	sink.listSessions?.();
}
function callGetStatus(sink: CommandSink): void {
	sink.getStatus?.();
}

/** Routes one parsed `ControlCommand` to the matching (optional) `CommandSink`
 * method. Split out of `dispatchCommands` purely to keep that loop's body
 * short. `restart` has no branch here — routing it to `sink.stop()` at this
 * layer would make it indistinguishable from an ordinary stop; `pollOnce`
 * (poll-loop.ts) reports `restartRequested` as its own `PollOutcome` AND
 * separately calls `sink.stop()` to actually end the current process. */
export function dispatchControlCommand(
	command: ControlCommand,
	sink: CommandSink
): void {
	if (command.action === "stop") {
		callStop(sink);
	} else if (command.action === "interrupt") {
		callInterrupt(sink);
	} else if (command.action === "setModel") {
		callSetModel(sink, command.model);
	} else if (command.action === "setPermissionMode") {
		callSetPermissionMode(sink, command.mode);
	} else if (command.action === "setThinking") {
		callSetThinking(sink, command.level);
	} else if (command.action === "listSessions") {
		callListSessions(sink);
	} else if (command.action === "getStatus") {
		callGetStatus(sink);
	}
}
