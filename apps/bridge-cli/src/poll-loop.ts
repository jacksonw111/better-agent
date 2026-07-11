// Polls the server for user commands and dispatches them to the agent. Split
// out of relay-client.ts to keep both files focused (and under the line cap).

import { type ControlOutcome, resolveControlOutcome } from "./command-outcome";
import type { AfterIdRef, CommandSink, RelayEvent } from "./commands";
import type { RelayTransport, Sleep } from "./relay-client";

const DEFAULT_MIN_INTERVAL_MS = 500;
// Idle backoff ceiling. Kept modest (2s, not 5s+) so the first command a user
// types in the web takes at most ~2s to be picked up even after the loop has
// gone idle — the bridge is interactive, not a batch poller.
const DEFAULT_MAX_INTERVAL_MS = 2000;
const BACKOFF_FACTOR = 2;

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
 * `pollLoop` to keep that loop's branching simple; the dispatch/status-push
 * bookkeeping itself lives in `resolveControlOutcome` (command-outcome.ts),
 * shared with the WS duplex transport's own command handling. */
async function pollOnce(args: PollOnceArgs): Promise<ControlOutcome> {
	const { transport, sessionId, sink, afterIdRef, options } = args;
	const commands = await transport.pollCommands({
		sessionId,
		afterId: afterIdRef.current,
	});
	if (commands.length > 0) {
		options.onCommands?.(commands);
	}
	return resolveControlOutcome({
		transport,
		sessionId,
		sink,
		afterIdRef,
		commands,
	});
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
