// A pending-approval registry shared by all three adapters: each keeps a
// requestId -> protocol-specific reply function, so `AgentHandle.answerApproval`
// has one uniform way to look a request up and invoke its reply, regardless
// of which wire protocol (codex JSON-RPC, opencode ACP, claude-code
// control_request) produced it. Cleared on process exit so a dead agent
// never leaves a dangling reply function that would write to a closed pipe.

import type { ApprovalOption, NormalizedEvent } from "../normalize/types";

/** Status emitted in place of a reply when `answer()` is called with a
 * `requestId` that was never registered, or was already answered. */
const APPROVAL_UNKNOWN_STATUS = "approval_unknown";

/** Status emitted in place of a reply when `answer()` is called with an
 * `optionId` that wasn't among the options announced on the matching
 * `ApprovalEvent` — e.g. a stale or hand-crafted client request. */
const APPROVAL_INVALID_OPTION_STATUS = "approval_invalid_option";

/** A still-open approval: the options the user was offered (to validate
 * `answer()`'s `optionId` against) and the reply to invoke once one is
 * picked. */
interface PendingApproval {
	options: ApprovalOption[];
	reply(optionId: string): void;
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
	 * whose `optionId` is one of `options`. */
	register(
		requestId: string,
		options: ApprovalOption[],
		reply: (optionId: string) => void
	): void;
	/**
	 * RC-T3: drops every still-pending reply WITHOUT invoking it — unlike
	 * `clear()` this is called mid-session, when `interrupt()`/`stop()`
	 * supersedes the current turn, so a late `answer()` for one of these ids
	 * can never resolve a resolver whose turn context has already changed
	 * (the audited claude-code bug: `interrupt()` left the pending approval
	 * live, and the user's later answer resolved it into the NEXT turn).
	 * Returns the requestIds that were pending, so the caller can push a
	 * retract/cancelled `ApprovalEvent` for each so the web removes the
	 * still-open card.
	 */
	retractAll(): string[];
}

/** Builds an `ApprovalRegistry` that reports unknown-id and invalid-option
 * answers on `events`. */
export function createApprovalRegistry(events: {
	push(event: NormalizedEvent): void;
}): ApprovalRegistry {
	const pending = new Map<string, PendingApproval>();
	return {
		register(requestId, options, reply) {
			pending.set(requestId, { options, reply });
		},
		answer(requestId, optionId) {
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
			entry.reply(optionId);
		},
		clear() {
			pending.clear();
		},
		retractAll() {
			const requestIds = [...pending.keys()];
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
