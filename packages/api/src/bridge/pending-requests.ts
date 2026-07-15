// P5-1 (docs/local-agent-workspace-plan.md): pure derivation for
// `bridge.pendingRequests` — which approval/question events in a session's
// persisted tail are STILL waiting for the user, and which requestIds were
// already answered from some device. Mirrors session-attention.ts's fold over
// the same wire shapes (which itself mirrors the web's
// bridge-turns-approval.ts fold), but keeps the EVENTS (verbatim, with their
// seqs) rather than just a boolean signal, so the web can replay a card that
// fell outside its history seed window.

import type { BridgeMessageRow } from "@better-agent/agent/ports";

/** A still-open approval/question, verbatim from the persisted stream: the
 * original event payload plus its relay seq, so the web can inject it through
 * the same id-deduped merge path a live frame takes. */
export interface PendingRequestRow {
	event: unknown;
	requestId: string;
	seq: number;
}

/** An approval/question the user already answered (from ANY device), read
 * back from the relay commands tail — the web marks the matching replayed
 * card as answered instead of leaving it actionable forever. */
export type AnsweredRequest =
	| { kind: "approval"; optionId: string; requestId: string }
	| { answers: string[][]; kind: "question"; requestId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `true` once wall-clock has passed the request's `timeoutAt` — the CLI's
 * fail-closed timer (`presentApproval`/`presentQuestion`) has already resolved
 * it declined by then, so replaying it as actionable would be a lie. Events
 * without a numeric `timeoutAt` (older CLIs) are never considered expired. */
function isExpired(event: Record<string, unknown>, nowMs: number): boolean {
	return typeof event.timeoutAt === "number" && event.timeoutAt <= nowMs;
}

/**
 * Walks the persisted events tail (ascending seq) and returns the
 * approval/question events with no `cancelled: true` retraction after them —
 * latest event per requestId wins, a retraction closes the id — excluding
 * requests whose fail-closed timeout has already passed. Ascending seq order.
 */
export function collectOpenRequestRows(
	rows: BridgeMessageRow[],
	nowMs: number
): PendingRequestRow[] {
	const open = new Map<string, PendingRequestRow>();
	for (const { seq, event } of rows) {
		if (!isRecord(event)) {
			continue;
		}
		if (event.kind !== "approval" && event.kind !== "question") {
			continue;
		}
		if (typeof event.requestId !== "string") {
			continue;
		}
		if (event.cancelled === true) {
			open.delete(event.requestId);
		} else if (!isExpired(event, nowMs)) {
			open.set(event.requestId, { event, requestId: event.requestId, seq });
		}
	}
	return [...open.values()].sort((a, b) => a.seq - b.seq);
}

/** Validates a question answer's `answers` payload (`string[][]`, see
 * apps/bridge-cli/src/commands-question.ts) without trusting the wire. */
function parseAnswers(value: unknown): string[][] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const groups: string[][] = [];
	for (const group of value) {
		if (!Array.isArray(group)) {
			return null;
		}
		if (!group.every((item): item is string => typeof item === "string")) {
			return null;
		}
		groups.push(group);
	}
	return groups;
}

/**
 * The requests the user has already answered, from the session's commands
 * tail: an approval decision is `{ type: "approval", requestId, optionId }`
 * and a question reply is `{ type: "control", action: "answerQuestion",
 * requestId, answers }` — see `apps/bridge-cli/src/commands.ts` /
 * `commands-question.ts`. Latest answer per requestId wins.
 */
export function collectAnsweredRequests(
	commands: unknown[]
): AnsweredRequest[] {
	const byId = new Map<string, AnsweredRequest>();
	for (const command of commands) {
		if (!isRecord(command) || typeof command.requestId !== "string") {
			continue;
		}
		if (command.type === "approval" && typeof command.optionId === "string") {
			byId.set(command.requestId, {
				kind: "approval",
				optionId: command.optionId,
				requestId: command.requestId,
			});
			continue;
		}
		if (command.type === "control" && command.action === "answerQuestion") {
			const answers = parseAnswers(command.answers);
			if (answers !== null) {
				byId.set(command.requestId, {
					answers,
					kind: "question",
					requestId: command.requestId,
				});
			}
		}
	}
	return [...byId.values()];
}
