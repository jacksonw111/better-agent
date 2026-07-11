// pi's `AgentHandle.sendWith` (R3-T1's busy-input policy) — split out of
// pi.ts purely to keep that file under the repo's 300-line limit.
//
// "steer" live-redirects the in-flight turn (pi's `streamingBehavior:
// "steer"`, per buildPiPromptCommand's doc) WITHOUT bumping the turn epoch or
// resetting the streaming tracker — the turn continues, just redirected, so
// output already in flight is still this same turn, not a stale straggler.
// "interrupt" aborts the in-flight turn exactly like `AgentHandle.interrupt`
// (bumps the epoch, resets the streaming tracker, writes the abort frame),
// then sends `text` as a fresh, always-bare prompt — a brand new turn.
// "queue" (and any other/absent value, for callers that don't pre-filter via
// `dispatchTextCommand`) is `send()`'s own followUp-when-streaming behavior.

import { buildPiPromptCommand } from "../normalize/pi-commands";
import { type NormalizedEvent, userMessageEvent } from "../normalize/types";
import { type ApprovalRegistry, retractPendingApprovals } from "./approvals";
import { type QuestionRegistry, retractPendingQuestions } from "./questions";
import { bumpTurnEpoch, type TurnEpochRef } from "./turn-epoch";
import type { TextWhen } from "./types";

interface PiSendWithDeps {
	// R3-1 review finding 1: sendInterrupted below retracts pending
	// extension_ui cards exactly like AgentHandle.interrupt does — it's the
	// same "abort the in-flight turn" step, just followed by a fresh send.
	approvals: ApprovalRegistry;
	epoch: TurnEpochRef;
	events: { push(event: NormalizedEvent): void };
	io: { writeLine(line: string): void };
	questions: QuestionRegistry;
	streaming: { isStreaming(): boolean; reset(): void };
}

function sendQueued(deps: PiSendWithDeps, text: string): void {
	bumpTurnEpoch(deps.epoch);
	deps.events.push(userMessageEvent(text));
	deps.io.writeLine(
		buildPiPromptCommand(
			text,
			deps.streaming.isStreaming() ? "followUp" : undefined
		)
	);
}

function sendSteered(deps: PiSendWithDeps, text: string): void {
	deps.events.push(userMessageEvent(text));
	deps.io.writeLine(buildPiPromptCommand(text, "steer"));
}

function sendInterrupted(deps: PiSendWithDeps, text: string): void {
	bumpTurnEpoch(deps.epoch);
	deps.streaming.reset();
	// R3-1 review finding 1: same retraction step as AgentHandle.interrupt —
	// this policy aborts the in-flight turn exactly like it does, so a
	// pending extension_ui card must not survive into the fresh turn started
	// below.
	retractPendingApprovals(deps.approvals, deps.events);
	retractPendingQuestions(deps.questions, deps.events);
	deps.io.writeLine(JSON.stringify({ type: "abort" }));
	deps.events.push(userMessageEvent(text));
	deps.io.writeLine(buildPiPromptCommand(text));
}

/** Builds the pi adapter's `sendWith` — dispatches to the matching busy-turn
 * policy above. */
export function makePiSendWith(
	deps: PiSendWithDeps
): (text: string, when: TextWhen) => void {
	return (text, when) => {
		if (when === "steer") {
			sendSteered(deps, text);
			return;
		}
		if (when === "interrupt") {
			sendInterrupted(deps, text);
			return;
		}
		sendQueued(deps, text);
	};
}
