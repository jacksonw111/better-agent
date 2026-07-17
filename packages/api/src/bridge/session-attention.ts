// P2-T1 (docs/local-agent-workspace-plan.md): derives a per-session
// "needs your attention" signal for `bridge.listSessions` from the TAIL of
// the session's relay streams — pure functions over the already-fetched tail
// arrays, so the router can bound the per-session work (readTail) and this
// module stays trivially unit-testable.

/** What (if anything) a session needs from the user right now:
 *  - "approval": an approval/question request is still waiting for an answer;
 *  - "processing": a turn looks in flight (the agent is working);
 *  - null: nothing notable (idle, ended, or stale). */
export type SessionAttention = "approval" | "processing" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Request ids of approval/question events with no `cancelled: true` retraction
 * after them, walking the events tail in order. Mirrors the web's fold
 * (`apps/web/src/components/bridge/bridge-turns-approval.ts`): a cancelled
 * event retracts the still-open card with the same `requestId` instead of
 * opening a new one.
 */
function collectOpenRequests(events: unknown[]): Set<string> {
	const open = new Set<string>();
	for (const event of events) {
		if (!isRecord(event)) {
			continue;
		}
		if (event.kind !== "approval" && event.kind !== "question") {
			continue;
		}
		if (typeof event.requestId !== "string") {
			continue;
		}
		// fix-approval-replay / fix-question-replay: a persisted resolution
		// event (answeredOptionId for approvals, answeredAnswers for questions)
		// closes the id like a retraction — the answer command may have expired
		// from the relay's commands window, but the resolution event survives,
		// so an answered approval/question never keeps flagging the session.
		if (
			event.cancelled === true ||
			event.answeredOptionId !== undefined ||
			event.answeredAnswers !== undefined
		) {
			open.delete(event.requestId);
		} else {
			open.add(event.requestId);
		}
	}
	return open;
}

/**
 * Request ids the user has already answered, from the session's commands tail:
 * an approval decision is `{ type: "approval", requestId, optionId }` and a
 * question reply is `{ type: "control", action: "answerQuestion", requestId,
 * answers }` — see `apps/bridge-cli/src/commands.ts` / `commands-question.ts`.
 */
function collectAnsweredRequests(commands: unknown[]): Set<string> {
	const answered = new Set<string>();
	for (const command of commands) {
		if (!isRecord(command) || typeof command.requestId !== "string") {
			continue;
		}
		const isApprovalAnswer = command.type === "approval";
		const isQuestionAnswer =
			command.type === "control" && command.action === "answerQuestion";
		if (isApprovalAnswer || isQuestionAnswer) {
			answered.add(command.requestId);
		}
	}
	return answered;
}

/**
 * Port of the web's `deriveTurnInFlight` (`apps/web/src/components/bridge/
 * terminal.tsx`): tail-first over the last renderable event so it can never
 * get stuck — a streaming assistant reply means NOT in flight (the text is
 * the signal), a user message means waiting for the agent, and a tool still
 * `started` means the agent is working silently. Status/approval/etc. events
 * are skipped so the scan lands on the real conversational tail.
 */
function deriveTurnInFlight(events: unknown[]): boolean {
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (!isRecord(event)) {
			continue;
		}
		if (event.kind === "output") {
			return false;
		}
		if (event.kind === "message") {
			return event.role === "user";
		}
		if (event.kind === "tool") {
			return event.status === "started";
		}
	}
	return false;
}

/**
 * The attention signal for one session, given bounded tails of its relay
 * streams (`events`/`commands` `data` payloads, oldest first). An unanswered,
 * unretracted approval/question wins over "processing" — a blocked turn IS in
 * flight, but what the user needs to do about it is answer. Callers gate on
 * session liveness (not ended, recently seen) BEFORE calling this.
 */
export function deriveSessionAttention(
	events: unknown[],
	commands: unknown[]
): SessionAttention {
	const open = collectOpenRequests(events);
	if (open.size > 0) {
		for (const requestId of collectAnsweredRequests(commands)) {
			open.delete(requestId);
		}
	}
	if (open.size > 0) {
		return "approval";
	}
	return deriveTurnInFlight(events) ? "processing" : null;
}
