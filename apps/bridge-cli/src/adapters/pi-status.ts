// pi's getStatus tracker, split out of pi.ts purely to keep it under the
// repo's max-lines-per-file gate — mirrors codex-status.ts/opencode-status.ts
// living alongside pi.ts the same way their normalize/ counterparts do.

import {
	buildPiGetStateCommand,
	normalizePiStateModel,
} from "../normalize/pi-commands";
import {
	buildPiGetSessionStatsCommand,
	normalizePiSessionStats,
	normalizePiStateRunning,
	type PiSessionStats,
} from "../normalize/pi-status";
import type { NormalizedEvent } from "../normalize/types";
import { STATUS_SNAPSHOT_STATUS } from "./types";

/** How long `request()` waits for both replies before giving up and pushing
 * whatever's known so far — pi has no request ids and, unlike claude-code's
 * SDK control channel, no guaranteed reply at all, so an unanswered
 * `get_session_stats`/`get_state` must never leave `pending` (and the web's
 * Status popover) stuck forever. Mirrors claude-code-status.ts's
 * `CONTROL_CALL_TIMEOUT_MS`. */
const STATUS_TIMEOUT_MS = 4000;

/**
 * RC-T6: pi's get_session_stats/get_state frames carry no request id, so a
 * reply can't be matched to the `request()` call that sent it by content
 * alone — only by command name. Without more, a SLOW reply from an earlier
 * `request()` still in flight when a NEWER `request()` re-arms (wiping
 * `stats`/`state` back to undefined) gets silently accepted into the new
 * generation's slot, pairing a stale field with a fresh one.
 *
 * Since pi answers over one ordered stdio pipe, replies for a given command
 * type arrive in the same order the requests went out — so one gate per
 * command type, counting outstanding (sent-but-not-yet-answered) requests,
 * fixes it: `arm()` on every `request()`, `accept()` on every matching
 * reply — it only returns `true` (accept into the snapshot) for the reply
 * that drains the count to zero, i.e. the reply to the MOST RECENTLY sent
 * request of that type. `reset()` (called from `resolve()`, answered or
 * timed out) zeroes the count the moment a generation is done: from then on
 * nothing is owed to it, so the next reply of that type is presumptively the
 * new generation's own — mirrors `pending`'s own true/false gate, which
 * already drops anything arriving once a generation has resolved.
 */
function createReplyGate(): { accept(): boolean; arm(): void; reset(): void } {
	let outstanding = 0;
	return {
		accept(): boolean {
			outstanding = Math.max(0, outstanding - 1);
			return outstanding === 0;
		},
		arm(): void {
			outstanding += 1;
		},
		reset(): void {
			outstanding = 0;
		},
	};
}

/** One pi model/running pair, as reported by a `get_state` reply. */
interface PiRunningState {
	model?: string;
	running?: boolean;
}

/** The mutable snapshot-in-progress state `makePiStatusTracker` drives — a
 * plain ref object (mirrors `turn-epoch.ts`'s `TurnEpochRef`) so each
 * transition below (`armSnapshot`/`resolveSnapshot`/`acceptSnapshot*`) can be
 * its own short top-level function instead of one long closure, keeping every
 * function under the repo's line-per-function gate. */
interface PendingSnapshotRef {
	events: { push(event: NormalizedEvent): void };
	pending: boolean;
	state: PiRunningState | undefined;
	stateGate: ReturnType<typeof createReplyGate>;
	stats: PiSessionStats | undefined;
	statsGate: ReturnType<typeof createReplyGate>;
	timer: ReturnType<typeof setTimeout> | undefined;
}

function createPendingSnapshot(events: {
	push(event: NormalizedEvent): void;
}): PendingSnapshotRef {
	return {
		events,
		pending: false,
		state: undefined,
		statsGate: createReplyGate(),
		stateGate: createReplyGate(),
		stats: undefined,
		timer: undefined,
	};
}

/** Pushes the `status_snapshot` event and resets both `createReplyGate`s —
 * from here nothing is owed to this generation, so the next reply of each
 * type is presumptively the NEXT `armSnapshot`'s own (see `createReplyGate`'s
 * RC-T6 doc comment). A no-op if this generation already resolved (via a
 * prior `resolveSnapshot` call or timeout). */
function resolveSnapshot(ref: PendingSnapshotRef): void {
	if (!ref.pending) {
		return;
	}
	ref.pending = false;
	ref.statsGate.reset();
	ref.stateGate.reset();
	clearTimeout(ref.timer);
	ref.events.push({
		kind: "status",
		status: STATUS_SNAPSHOT_STATUS,
		detail: {
			model: ref.state?.model,
			running: ref.state?.running,
			...ref.stats,
		},
	});
}

/** Re-arms `ref` for a fresh `getStatus` generation: clears the previous
 * generation's fields, arms both reply gates, and (re)starts the
 * `STATUS_TIMEOUT_MS` fallback. */
function armSnapshot(ref: PendingSnapshotRef): void {
	ref.pending = true;
	ref.stats = undefined;
	ref.state = undefined;
	ref.statsGate.arm();
	ref.stateGate.arm();
	clearTimeout(ref.timer);
	ref.timer = setTimeout(() => resolveSnapshot(ref), STATUS_TIMEOUT_MS);
}

function acceptSnapshotStats(
	ref: PendingSnapshotRef,
	next: PiSessionStats
): void {
	if (ref.statsGate.accept()) {
		ref.stats = next;
	}
	if (ref.stats && ref.state) {
		resolveSnapshot(ref);
	}
}

function acceptSnapshotState(
	ref: PendingSnapshotRef,
	next: PiRunningState
): void {
	if (ref.stateGate.accept()) {
		ref.state = next;
	}
	if (ref.stats && ref.state) {
		resolveSnapshot(ref);
	}
}

/**
 * Tracks one in-flight `getStatus` request: `request()` fires the
 * `get_session_stats` + `get_state` frames, `onLine` collects both replies,
 * and ONE `status_snapshot` event is pushed the moment both have arrived (a
 * new `request()` before then simply re-arms with fresh frames) — or,
 * failing that, once `STATUS_TIMEOUT_MS` elapses, with whichever piece(s)
 * never arrived simply absent. pi has no request ids, so replies are matched
 * by command name (see the ASSUMPTION notes in normalize/pi-status.ts for the
 * response shapes) gated per-generation by `createReplyGate`/`PendingSnapshotRef`
 * above so a straggler from a superseded `request()` call can't be mistaken
 * for the current one's answer.
 */
export function makePiStatusTracker(
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void }
): { onLine(raw: unknown): void; request(): void } {
	const snapshot = createPendingSnapshot(events);

	return {
		request(): void {
			armSnapshot(snapshot);
			io.writeLine(buildPiGetSessionStatsCommand());
			io.writeLine(buildPiGetStateCommand());
		},
		onLine(raw: unknown): void {
			if (!snapshot.pending) {
				return;
			}
			const nextStats = normalizePiSessionStats(raw);
			if (nextStats) {
				acceptSnapshotStats(snapshot, nextStats);
			}
			const running = normalizePiStateRunning(raw);
			if (running !== undefined) {
				acceptSnapshotState(snapshot, {
					model: normalizePiStateModel(raw),
					running,
				});
			}
		},
	};
}
