// Split out of bridge-session-status.ts purely to keep that file under the
// repo's max-lines-per-file gate. Not re-exported back from there (that would
// make the two files circularly depend on each other) — consumers import
// these symbols from this file directly.
import type { StreamEvent } from "./bridge-events";
import {
	asOptionalNumber,
	asOptionalString,
	isRecord,
	latestStatusDetail,
} from "./bridge-session-status";

/** Pushed by the claude adapter in reply to a `{ control: listSessions }`
 * command (see `apps/bridge-cli/src/adapters/claude-code.ts`'s
 * `makeListSessions`) — the "Past conversations" picker's data. */
export const SESSION_LIST_STATUS = "session_list";

/** One past local conversation the "Past conversations" picker renders —
 * mirrors `SessionListItem` in
 * `apps/bridge-cli/src/adapters/claude-code.ts`. */
export interface SessionListItem {
	cwd?: string;
	gitBranch?: string;
	id: string;
	lastModified?: number;
	title: string;
}

export interface SessionListDetail {
	sessions: SessionListItem[];
}

function asOptionalSessionListItems(
	value: unknown
): SessionListItem[] | undefined {
	if (!Array.isArray(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const items: SessionListItem[] = [];
	for (const item of value) {
		if (isRecord(item) && typeof item.id === "string") {
			items.push({
				id: item.id,
				title: asOptionalString(item.title) ?? item.id,
				lastModified: asOptionalNumber(item.lastModified),
				gitBranch: asOptionalString(item.gitBranch),
				cwd: asOptionalString(item.cwd),
			});
		}
	}
	return items;
}

export function parseSessionListDetail(
	detail: unknown
): SessionListDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	const sessions = asOptionalSessionListItems(detail.sessions);
	return sessions === undefined ? null : { sessions };
}

/** The latest `session_list` detail on the feed — `null` before a `{
 * control: listSessions }` request has gotten a reply (or the reply was
 * malformed). */
export function latestSessionListDetail(
	events: StreamEvent[]
): SessionListDetail | null {
	const detail = latestStatusDetail(events, SESSION_LIST_STATUS);
	return detail === undefined ? null : parseSessionListDetail(detail);
}
