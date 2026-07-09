// Polls the server for user commands and dispatches them to the agent. Split
// out of relay-client.ts to keep both files focused (and under the line cap).

import {
	type AfterIdRef,
	type CommandSink,
	dispatchCommands,
	type RelayEvent,
} from "./commands";
import type { StatusEvent } from "./normalize/types";
import type { RelayTransport, Sleep } from "./relay-client";

const DEFAULT_MIN_INTERVAL_MS = 500;
// Idle backoff ceiling. Kept modest (2s, not 5s+) so the first command a user
// types in the web takes at most ~2s to be picked up even after the loop has
// gone idle — the bridge is interactive, not a batch poller.
const DEFAULT_MAX_INTERVAL_MS = 2000;
const BACKOFF_FACTOR = 2;
const STOPPED_BY_SERVER_STATUS = "stopped_by_server";
// Pushed instead of STOPPED_BY_SERVER_STATUS when the loop is ending because
// of a `control: restart` (not `stop`) — the web feed gets an explicit "the
// agent is reconfiguring, not gone for good" marker.
const RESTARTING_STATUS = "restarting";

/**
 * Why `pollLoop` returned: `"stopped"` for a server-issued `control: stop`
 * command (the caller should end the session outright), `"restart"` for a
 * server-issued `control: restart` command (the caller — the outer restart
 * loop in `restart-loop.ts` — should reconfigure and relaunch the agent
 * under the SAME bridge sessionId, without exiting the process), or
 * `"ended"` for any other reason `signal` aborted — in practice almost
 * always `runBridgeSession`'s own `forwardEvents(...).finally(stopPolling)`
 * firing once the agent's event stream completes on its own (the process
 * exited), but also an externally aborted `signal` (e.g. SIGINT).
 */
export type PollOutcome = "ended" | "restart" | "stopped";

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollLoopOptions {
	maxIntervalMs?: number;
	minIntervalMs?: number;
	/** Debug hook: called with each non-empty batch of commands pulled from the
	 * server, so `--debug` can show that input actually reached the agent. */
	onCommands?: (commands: RelayEvent[]) => void;
	onError?: (error: unknown) => void;
	signal: AbortSignal;
	sleep?: Sleep;
}

/** Best-effort: pushes a status event straight to the server (bypassing the
 * agent's own event queue, which `forwardEvents` drains separately) so the
 * web UI's feed gets an explicit last word before the loop ends. Swallows
 * failure — the session is winding down (or about to relaunch) either way,
 * and there's no one left to retry for. Shared by `pushStoppedByServerStatus`
 * and `pushRestartingStatus`. */
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

/** Pushes a final status event noting the session was stopped remotely — see
 * `pushBestEffortStatus`. */
function pushStoppedByServerStatus(
	transport: RelayTransport,
	sessionId: string
): Promise<void> {
	return pushBestEffortStatus(transport, sessionId, STOPPED_BY_SERVER_STATUS);
}

/** Pushes a status event noting the session is restarting (reconfiguring and
 * relaunching in place, NOT ending) — see `pushBestEffortStatus`. */
function pushRestartingStatus(
	transport: RelayTransport,
	sessionId: string
): Promise<void> {
	return pushBestEffortStatus(transport, sessionId, RESTARTING_STATUS);
}

interface PollOnceArgs {
	afterIdRef: AfterIdRef;
	options: PollLoopOptions;
	sessionId: string;
	sink: CommandSink;
	transport: RelayTransport;
}

/** One poll+dispatch cycle: returns which control command (if any) landed —
 * `"stop"`/`"restart"`, or `undefined` for an ordinary poll — and whether
 * this poll delivered any commands (to reset the backoff). Extracted from
 * `pollLoop` to keep that loop's branching simple. */
async function pollOnce(
	args: PollOnceArgs
): Promise<{ control?: "restart" | "stop"; wasActive: boolean }> {
	const { transport, sessionId, sink, afterIdRef, options } = args;
	const commands = await transport.pollCommands({
		sessionId,
		afterId: afterIdRef.current,
	});
	if (commands.length > 0) {
		options.onCommands?.(commands);
	}
	const { wasActive, stopRequested, restartRequested } = dispatchCommands(
		commands,
		sink,
		afterIdRef
	);
	if (stopRequested) {
		await pushStoppedByServerStatus(transport, sessionId);
		return { control: "stop", wasActive };
	}
	if (restartRequested) {
		await pushRestartingStatus(transport, sessionId);
		// `dispatchControlCommand` deliberately routes "restart" to no
		// `CommandSink` method (see its comment in commands.ts) — but the
		// CURRENT agent process still has to actually exit, or `handle.events`
		// never completes and `runBridgeSession`'s `forwardEvents` half of its
		// `Promise.all` hangs forever waiting on it (its own unconditional
		// `finally` call to `handle.stop()` only runs AFTER that `Promise.all`
		// resolves — too late to unblock it). Reusing the existing `stop()`
		// method here — same teardown as a real `control: stop`, just not
		// routed through `stopRequested` — is what actually ends the process
		// so the outer restart loop can relaunch a fresh one.
		sink.stop?.();
		return { control: "restart", wasActive };
	}
	return { wasActive };
}

type PollStep = { interval: number } | { outcome: PollOutcome };

/** One trip through the loop body: a poll that lands a `stop`/`restart`
 * control command (or throws) short-circuits to a terminal `PollOutcome`;
 * anything else just yields the next interval to sleep for. Extracted from
 * `pollLoop` to keep that loop's own branching (and cyclomatic complexity)
 * simple. */
async function pollStep(
	args: PollOnceArgs,
	interval: number,
	minIntervalMs: number,
	maxIntervalMs: number
): Promise<PollStep> {
	try {
		const { control, wasActive } = await pollOnce(args);
		if (control === "stop") {
			return { outcome: "stopped" };
		}
		if (control === "restart") {
			return { outcome: "restart" };
		}
		return {
			interval: wasActive
				? minIntervalMs
				: Math.min(interval * BACKOFF_FACTOR, maxIntervalMs),
		};
	} catch (error) {
		args.options.onError?.(error);
		return { interval: maxIntervalMs };
	}
}

/**
 * Polls `pollCommands(afterId)` in a loop, dispatching each command to `sink` —
 * a text command calls `sink.send`, an approval command calls
 * `sink.answerApproval`. The interval speeds back up to `minIntervalMs` right
 * after an active poll and backs off toward `maxIntervalMs` while idle. A
 * transient transport error is swallowed (reported via `onError`) and retried
 * at `maxIntervalMs`; `afterIdRef` is left untouched so the next successful poll
 * resumes exactly where the last one left off. A `control: stop` or
 * `control: restart` command ends the loop immediately (after a matching
 * best-effort status push) with the corresponding `PollOutcome` — see that
 * type for how the two differ (and what `"ended"` means for everything else).
 */
export async function pollLoop(
	transport: RelayTransport,
	sessionId: string,
	sink: CommandSink,
	afterIdRef: AfterIdRef,
	options: PollLoopOptions
): Promise<PollOutcome> {
	const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
	const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
	const sleep = options.sleep ?? defaultSleep;
	let interval = minIntervalMs;

	while (!options.signal.aborted) {
		const step = await pollStep(
			{ afterIdRef, options, sessionId, sink, transport },
			interval,
			minIntervalMs,
			maxIntervalMs
		);
		if ("outcome" in step) {
			return step.outcome;
		}
		interval = step.interval;
		if (options.signal.aborted) {
			break;
		}
		await sleep(interval);
	}
	return "ended";
}
