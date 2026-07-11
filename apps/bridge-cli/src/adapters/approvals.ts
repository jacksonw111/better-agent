// A pending-approval registry shared by all three adapters: each keeps a
// requestId -> protocol-specific reply function, so `AgentHandle.answerApproval`
// has one uniform way to look a request up and invoke its reply, regardless
// of which wire protocol (codex JSON-RPC, opencode ACP, claude-code
// control_request) produced it. Cleared on process exit so a dead agent
// never leaves a dangling reply function that would write to a closed pipe.

import type {
	ApprovalEvent,
	ApprovalOption,
	NormalizedEvent,
} from "../normalize/types";

/** Status emitted in place of a reply when `answer()` is called with a
 * `requestId` that was never registered, or was already answered. */
const APPROVAL_UNKNOWN_STATUS = "approval_unknown";

/** Status emitted in place of a reply when `answer()` is called with an
 * `optionId` that wasn't among the options announced on the matching
 * `ApprovalEvent` — e.g. a stale or hand-crafted client request. */
const APPROVAL_INVALID_OPTION_STATUS = "approval_invalid_option";

const APPROVAL_TIMEOUT_MINUTES = 5;
const MS_PER_MINUTE = 60_000;

/** RC-T4: how long an approval card can sit unanswered before `presentApproval`
 * gives up and resolves it declined — long enough a human has a real chance to
 * see and act on it, short enough a forgotten card doesn't block a session
 * indefinitely. No product spec pins this exact figure down; ASSUMPTION: 5
 * minutes, the same order of magnitude as this file's other adapters' own
 * request timeouts (e.g. `opencode-serve-http.ts`'s `REQUEST_TIMEOUT_MS`,
 * `claude-code-status.ts`'s `CONTROL_CALL_TIMEOUT_MS`, both far shorter since
 * they bound a machine-to-machine RPC rather than a human decision). */
export const APPROVAL_TIMEOUT_MS = APPROVAL_TIMEOUT_MINUTES * MS_PER_MINUTE;

/** A still-open approval: the options the user was offered (to validate
 * `answer()`'s `optionId` against), the reply to invoke once one is picked,
 * and — RC-fix3 — the fail-closed timer `presentApproval` armed for it, if
 * any, so `retract`/`retractAll`/`answer` can clear it instead of leaking a
 * dangling `setTimeout` past the point this entry stops being pending. */
interface PendingApproval {
	options: ApprovalOption[];
	reply(optionId: string): void;
	timer?: ReturnType<typeof setTimeout>;
}

export interface ApprovalRegistry {
	/**
	 * Looks up `requestId` and invokes its reply function with `optionId`,
	 * removing it from the registry so a duplicate `answer()` call for the
	 * same id is a no-op. An unknown id (never registered, already answered,
	 * or dropped by `clear()`) emits a `status` warning event instead of
	 * throwing, since the agent may simply have moved on by the time the
	 * user answers. An `optionId` that isn't among the options announced at
	 * `register()` time also emits a `status` warning instead of replying,
	 * but leaves the approval pending so a corrected answer can still land.
	 */
	answer(requestId: string, optionId: string): void;
	/** Drops every still-pending reply function. Call once the agent process
	 * has exited, so a later `answer()` for a stale id can never write to a
	 * closed pipe. */
	clear(): void;
	/** Registers `reply` to be invoked (at most once) by a matching `answer()`
	 * whose `optionId` is one of `options`. `timer` — RC-fix3 — is the
	 * fail-closed timer `presentApproval` armed for this approval, if any;
	 * stashing it here lets `retract`/`retractAll`/`answer` clear it so it
	 * never fires (and leaks) after this entry stops being pending. */
	register(
		requestId: string,
		options: ApprovalOption[],
		reply: (optionId: string) => void,
		timer?: ReturnType<typeof setTimeout>
	): void;
	/**
	 * RC-T4: drops `requestId`'s pending reply WITHOUT invoking it, same
	 * fail-closed contract as `retractAll` but scoped to one id — the shared
	 * timeout in `presentApproval` below uses this so a card whose timer fires
	 * after it was ALREADY answered (or already retracted by an interrupt) is a
	 * harmless no-op instead of double-resolving it. Returns whether an entry
	 * was actually removed, so the caller can tell "I won the race, resolve
	 * declined" apart from "someone else already resolved this." RC-fix3: also
	 * clears the entry's armed timer (if any), so retracting an approval
	 * before its timeout fires doesn't leave a dangling `setTimeout` behind.
	 */
	retract(requestId: string): boolean;
	/**
	 * RC-T3: drops every still-pending reply WITHOUT invoking it — unlike
	 * `clear()` this is called mid-session, when `interrupt()`/`stop()`
	 * supersedes the current turn, so a late `answer()` for one of these ids
	 * can never resolve a resolver whose turn context has already changed
	 * (the audited claude-code bug: `interrupt()` left the pending approval
	 * live, and the user's later answer resolved it into the NEXT turn).
	 * Returns the requestIds that were pending, so the caller can push a
	 * retract/cancelled `ApprovalEvent` for each so the web removes the
	 * still-open card. RC-fix3: also clears each dropped entry's armed timer
	 * (if any) — same leaked-timer fix as `retract`, for the bulk path.
	 */
	retractAll(): string[];
}

/** `answer()`'s implementation, pulled out of `createApprovalRegistry`'s
 * returned object literal so that function stays under this file's
 * max-lines-per-function lint gate — behavior is unchanged. */
function answerPending(
	pending: Map<string, PendingApproval>,
	events: { push(event: NormalizedEvent): void },
	requestId: string,
	optionId: string
): void {
	const entry = pending.get(requestId);
	if (!entry) {
		events.push({
			kind: "status",
			status: APPROVAL_UNKNOWN_STATUS,
			detail: { requestId },
		});
		return;
	}
	if (!entry.options.some((option) => option.id === optionId)) {
		events.push({
			kind: "status",
			status: APPROVAL_INVALID_OPTION_STATUS,
			detail: { requestId, optionId },
		});
		return;
	}
	pending.delete(requestId);
	// RC-fix3: belt-and-braces alongside presentApproval's own
	// clearTimeout in its reply wrapper — harmless if already cleared.
	clearTimeout(entry.timer);
	entry.reply(optionId);
}

/** Builds an `ApprovalRegistry` that reports unknown-id and invalid-option
 * answers on `events`. */
export function createApprovalRegistry(events: {
	push(event: NormalizedEvent): void;
}): ApprovalRegistry {
	const pending = new Map<string, PendingApproval>();
	return {
		register(requestId, options, reply, timer) {
			pending.set(requestId, { options, reply, timer });
		},
		answer(requestId, optionId) {
			answerPending(pending, events, requestId, optionId);
		},
		clear() {
			pending.clear();
		},
		retract(requestId) {
			const entry = pending.get(requestId);
			if (!entry) {
				return false;
			}
			pending.delete(requestId);
			clearTimeout(entry.timer);
			return true;
		},
		retractAll() {
			const requestIds = [...pending.keys()];
			for (const entry of pending.values()) {
				clearTimeout(entry.timer);
			}
			pending.clear();
			return requestIds;
		},
	};
}

/**
 * RC-T3: retracts every pending approval on `approvals` and pushes a
 * cancelled `ApprovalEvent` for each so the web removes the still-open card
 * — the shared "interrupt clears pending approvals + retracts cards" step
 * every adapter's `interrupt()`/`stop()` calls (see the design note on
 * `ApprovalRegistry.retractAll`). A no-op when nothing was pending.
 */
export function retractPendingApprovals(
	approvals: ApprovalRegistry,
	events: { push(event: NormalizedEvent): void }
): void {
	for (const requestId of approvals.retractAll()) {
		events.push({
			kind: "approval",
			cancelled: true,
			options: [],
			requestId,
			title: "Cancelled",
		});
	}
}

/**
 * RC-T4: the fail-closed contract EVERY adapter's approval path routes
 * through — codex/opencode's `onRequest`-surfaced approvals and opencode
 * serve's SSE-surfaced ones alike. Fixes the audited class of bug where a
 * malformed or simply unanswered approval request left the underlying tool
 * call blocked FOREVER with no card, no timeout, and no way for the user to
 * ever unblock it (opencode: an empty `options` array made the normalizer
 * drop the request entirely before it ever reached this registry; pi: no
 * approval concept at all, so a stuck confirmation prompt had nowhere to go).
 * The guarantee this establishes: an approval is always either answered by
 * the user, or — once `APPROVAL_TIMEOUT_MS` elapses with no answer — resolved
 * as a VISIBLE decline, never a silent hang and never an auto-allow.
 *
 * Sequence: `register()`s `onAnswer` with the registry, pushes `event` (the
 * card) onto `events`, and arms a timer. If the timer fires before an answer
 * arrives, `approvals.retract(event.requestId)` — which only succeeds if
 * nothing already claimed this id (an on-time answer, or an unrelated
 * `retractAll()` from an interrupt) — pushes a visible "timed out — declined"
 * event and calls `onTimeout`. An on-time answer clears the timer so it can
 * never fire after the fact.
 *
 * R3-T2: the pushed card is also stamped with `timeoutAt` — the epoch ms
 * this same timer will fire at — so the web can render a countdown toward
 * the exact instant this approval resolves declined if nobody answers.
 *
 * Params are bundled into one object (rather than five positional args) to
 * stay under this file's max-params lint gate.
 */
export interface PresentApprovalOptions {
	approvals: ApprovalRegistry;
	event: ApprovalEvent;
	events: { push(event: NormalizedEvent): void };
	onAnswer: (optionId: string) => void;
	onTimeout: () => void;
}

export function presentApproval(options: PresentApprovalOptions): void {
	const { approvals, events, event, onAnswer, onTimeout } = options;
	// R3-T2: computed once, up front, so it names the exact instant the timer
	// armed just below will fire at — not a slightly-later `Date.now()` read
	// at push time.
	const timeoutAt = Date.now() + APPROVAL_TIMEOUT_MS;
	const timer = setTimeout(() => {
		if (!approvals.retract(event.requestId)) {
			// Already answered, or already retracted by an interrupt — the
			// timeout lost the race, so it must not double-resolve this id.
			return;
		}
		events.push({
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: event.requestId,
			title: "Timed out — declined",
		});
		onTimeout();
	}, APPROVAL_TIMEOUT_MS);

	approvals.register(
		event.requestId,
		event.options,
		(optionId) => {
			clearTimeout(timer);
			onAnswer(optionId);
		},
		timer
	);
	events.push({ ...event, timeoutAt });
}
