// Shared control-command bookkeeping for BOTH command transports
// (poll-loop.ts's HTTP polling and, since R0-T2, ws-duplex's push-delivered
// commands): dispatches a batch of relayed commands to a `CommandSink`, and
// — if a `control: stop`/`control: restart` landed — pushes the matching
// best-effort status event and reports which one, so poll-loop.ts's
// `pollOnce` and run-bridge-session-duplex.ts's per-command handler produce
// IDENTICAL `PollOutcome`-worthy results from the exact same dispatch logic
// instead of two copies drifting apart. Split out of poll-loop.ts (which
// used to own this outright) purely so ws-duplex mode can reuse it.

import {
	type AfterIdRef,
	type CommandSink,
	dispatchCommands,
	type RelayEvent,
} from "./commands";
import type { StatusEvent } from "./normalize/types";
import type { RelayTransport } from "./relay-client";

const STOPPED_BY_SERVER_STATUS = "stopped_by_server";
// Pushed instead of STOPPED_BY_SERVER_STATUS when the loop is ending because
// of a `control: restart` (not `stop`) — the web feed gets an explicit "the
// agent is reconfiguring, not gone for good" marker.
const RESTARTING_STATUS = "restarting";

/** Best-effort: pushes a status event straight to the server (bypassing the
 * agent's own event queue, which `forwardEvents` drains separately) so the
 * web UI's feed gets an explicit last word before the loop ends. Swallows
 * failure — the session is winding down (or about to relaunch) either way,
 * and there's no one left to retry for. */
async function pushBestEffortStatus(
	transport: RelayTransport,
	sessionId: string,
	status: string
): Promise<void> {
	try {
		const event: StatusEvent = { kind: "status", status };
		await transport.pushEvents({ sessionId, events: [event] });
	} catch {
		// best-effort — nothing else to do here.
	}
}

/** Which control command (if any) `resolveControlOutcome` saw, and whether
 * the batch it dispatched carried any commands at all (poll-loop.ts uses
 * `wasActive` to decide whether to speed back up or keep backing off — WS
 * mode has no equivalent backoff, so it just ignores this field). */
export interface ControlOutcome {
	control?: "restart" | "stop";
	wasActive: boolean;
}

export interface ResolveControlOutcomeArgs {
	afterIdRef: AfterIdRef;
	commands: RelayEvent[];
	sessionId: string;
	sink: CommandSink;
	transport: RelayTransport;
}

/**
 * Dispatches `commands` to `sink` (advancing `afterIdRef` past every one seen
 * — see `dispatchCommands`), and if a `control: stop` or `control: restart`
 * landed, pushes the matching best-effort status event before reporting it.
 * `restart` also calls `sink.stop()` directly: `dispatchCommands` itself
 * deliberately routes "restart" to no `CommandSink` method (see
 * commands.ts's `dispatchControlCommand`), since routing it to `sink.stop()`
 * at that layer would make it indistinguishable from an ordinary stop — the
 * CURRENT agent process still has to actually exit so the caller's event
 * stream (`forwardEvents`) completes and the outer restart loop can relaunch
 * a fresh one under the SAME bridge sessionId.
 */
export async function resolveControlOutcome(
	args: ResolveControlOutcomeArgs
): Promise<ControlOutcome> {
	const { transport, sessionId, sink, afterIdRef, commands } = args;
	const { wasActive, stopRequested, restartRequested } = dispatchCommands(
		commands,
		sink,
		afterIdRef
	);
	if (stopRequested) {
		await pushBestEffortStatus(transport, sessionId, STOPPED_BY_SERVER_STATUS);
		return { control: "stop", wasActive };
	}
	if (restartRequested) {
		await pushBestEffortStatus(transport, sessionId, RESTARTING_STATUS);
		sink.stop?.();
		return { control: "restart", wasActive };
	}
	return { wasActive };
}
