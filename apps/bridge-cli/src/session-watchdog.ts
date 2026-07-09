// RC-T5 (docs/remote-control-plan.md, Pillar 4): per-session activity
// watchdog — detects a wedged turn (the agent process is alive, but silent
// past `STALL_MS` with no approval card open) so `relay-client.ts` can
// interrupt + retire it instead of the session hanging forever. A pure state
// machine, deliberately kept free of `RelayTransport`/`CommandSink` — see
// `session-watchdog-wiring.ts` for the glue that hooks this into
// `runBridgeSession`. Split out purely to keep both files under the repo's
// max-lines-per-file gate and to make the state machine itself independently
// testable with `vi.useFakeTimers()`.
//
// Uses the bare global `setTimeout`/`clearTimeout` (not injected) — same as
// `adapters/approvals.ts`'s `presentApproval` — so `vi.useFakeTimers()`
// patches it directly in tests; no DI needed. This is UNLIKE
// `opencode-serve-http.ts`'s `AbortSignal.timeout`, which fake timers can't
// patch — see that file's test for why.

import { AGENT_EXITED_STATUS } from "./adapters/types";
import { isRecord } from "./normalize/types";

/** Status pushed straight to the server (bypassing the agent's own event
 * queue — mirrors poll-loop.ts's `pushBestEffortStatus`) the moment the
 * watchdog fires, so the web feed gets a visible "this turn wedged" marker
 * before the session is torn down and relaunched. */
export const STALLED_STATUS = "stalled";

/** How long an ACTIVE turn may go without a single forwarded event before
 * it's considered wedged. ASSUMPTION: no product spec pins this figure down;
 * 90s is long enough that a slow-but-alive tool call (a big file read, a slow
 * shell command) doesn't false-positive, short enough that a genuinely hung
 * subprocess doesn't leave a session dark for the rest of a user's session. */
export const STALL_MS = 90_000;

// Each adapter's own "the turn is over" status string — see the per-adapter
// normalizers: claude-code's `normalizeClaudeResult` ("turn_usage", from the
// SDK's `result` line), codex's `CODEX_NOTIFICATION_HANDLERS`
// ("turn_completed"), pi's `PI_STATUS_TYPES` and opencode-serve's
// `session.idle` handler (both "turn_end"). No adapter uses more than one of
// these, so a flat set is enough — there's no cross-adapter ambiguity to
// resolve.
const TURN_END_STATUSES = new Set(["turn_usage", "turn_completed", "turn_end"]);

type SessionWatchdogState = "active" | "approval-open" | "idle" | "stopped";

/** Mutable state the module-level transition helpers below operate on —
 * kept as a plain object (not closures) so each transition can be its own
 * short top-level function, mirroring `turn-epoch.ts`'s `TurnEpochRef`. */
interface WatchdogRef {
	onStall: () => void;
	stallMs: number;
	state: SessionWatchdogState;
	timer?: ReturnType<typeof setTimeout>;
}

function clearWatchdogTimer(ref: WatchdogRef): void {
	if (ref.timer !== undefined) {
		clearTimeout(ref.timer);
		ref.timer = undefined;
	}
}

function armWatchdogTimer(ref: WatchdogRef): void {
	clearWatchdogTimer(ref);
	ref.timer = setTimeout(() => {
		ref.timer = undefined;
		ref.state = "stopped";
		ref.onStall();
	}, ref.stallMs);
}

/** Moves to `"active"` and (re)arms the clock — a new turn starting, or an
 * approval that was open just got answered. A no-op once `dispose()`d. */
function transitionToActive(ref: WatchdogRef): void {
	if (ref.state === "stopped") {
		return;
	}
	ref.state = "active";
	armWatchdogTimer(ref);
}

/** Moves to `"idle"` and stops the clock — the turn is over (its own
 * completion status arrived, it was cut short by an interrupt, or the agent
 * exited) and the session is now legitimately waiting on the user, not
 * stalled. A no-op once `dispose()`d. */
function transitionToIdle(ref: WatchdogRef): void {
	if (ref.state === "stopped") {
		return;
	}
	ref.state = "idle";
	clearWatchdogTimer(ref);
}

function statusOf(event: unknown): string | undefined {
	return isRecord(event) &&
		event.kind === "status" &&
		typeof event.status === "string"
		? event.status
		: undefined;
}

function isTerminalStatusEvent(event: unknown): boolean {
	const status = statusOf(event);
	return (
		status === AGENT_EXITED_STATUS ||
		(status !== undefined && TURN_END_STATUSES.has(status))
	);
}

/**
 * An `ApprovalEvent` either opens a card (pauses the clock — the agent is
 * legitimately waiting on a human, not stalled) or retracts one
 * (`cancelled: true`). A retraction only resumes the clock if THIS watchdog
 * is the one that had it paused (`state === "approval-open"`): an interrupt
 * retracts a pending card too, but `session-watchdog-wiring.ts`'s
 * `watchdogSink` calls `observeTurnEnd()` synchronously BEFORE the
 * interrupt's retraction event is even pushed, so by the time it arrives here
 * `state` is already `"idle"` and this guard correctly leaves it alone
 * instead of incorrectly resuming a turn that's actually over.
 */
function observeApprovalEvent(ref: WatchdogRef, cancelled: boolean): void {
	if (!cancelled) {
		ref.state = "approval-open";
		clearWatchdogTimer(ref);
		return;
	}
	if (ref.state === "approval-open") {
		transitionToActive(ref);
	}
}

function observeWatchdogEvent(ref: WatchdogRef, event: unknown): void {
	if (ref.state === "stopped") {
		return;
	}
	if (isTerminalStatusEvent(event)) {
		transitionToIdle(ref);
		return;
	}
	if (isRecord(event) && event.kind === "approval") {
		observeApprovalEvent(ref, event.cancelled === true);
		return;
	}
	if (ref.state === "active") {
		armWatchdogTimer(ref);
	}
}

export interface SessionWatchdogOptions {
	/** Fired at most once, the moment `STALL_MS` elapses with no activity
	 * while a turn is `"active"`. The watchdog moves to `"stopped"` right
	 * before calling this and never re-arms — the caller owns tearing the
	 * session down (see `session-watchdog-wiring.ts`'s `makeOnStall`). */
	onStall: () => void;
	/** See `STALL_MS`. Override for tests only — production always takes the
	 * default. */
	stallMs?: number;
}

export interface SessionWatchdog {
	/** Tears the watchdog down: clears any armed timer and moves to
	 * `"stopped"`, after which every other method is a no-op. Idempotent —
	 * safe to call more than once (e.g. once from `onStall`'s own reaction,
	 * once more from `runBridgeSession`'s own teardown). */
	dispose(): void;
	/** A pending approval was just answered (`CommandSink.answerApproval`) —
	 * resumes the clock. */
	observeApprovalAnswered(): void;
	/** Feeds one forwarded event through the state machine — see
	 * `observeWatchdogEvent`. */
	observeEvent(event: unknown): void;
	/** The in-flight turn was just cut short by an interrupt
	 * (`CommandSink.interrupt`) — stops the clock; the session is now idle,
	 * awaiting the next `send`, not stalled. */
	observeTurnEnd(): void;
	/** A new turn just began (`CommandSink.send`) — (re)arms the clock. */
	observeTurnStart(): void;
}

/** Builds a fresh watchdog, starting `"idle"` (a session's first turn hasn't
 * begun yet — `observeTurnStart()` is what actually arms the clock). */
export function createSessionWatchdog(
	options: SessionWatchdogOptions
): SessionWatchdog {
	const ref: WatchdogRef = {
		onStall: options.onStall,
		stallMs: options.stallMs ?? STALL_MS,
		state: "idle",
	};
	return {
		dispose(): void {
			clearWatchdogTimer(ref);
			ref.state = "stopped";
		},
		observeApprovalAnswered(): void {
			transitionToActive(ref);
		},
		observeEvent(event: unknown): void {
			observeWatchdogEvent(ref, event);
		},
		observeTurnEnd(): void {
			transitionToIdle(ref);
		},
		observeTurnStart(): void {
			transitionToActive(ref);
		},
	};
}
