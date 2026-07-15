// P4-T5: wire shapes for the cross-session search channel's single reply. The
// CLI answers a `searchSessions {requestId, query}` control command with ONE
// `session_search` STATUS event (see apps/bridge-cli/src/adapters/
// session-search.ts — keep the shapes in sync), parsed here (lightly: trusted
// same-origin CLI wire, like git-events.ts) and correlated back to callers by
// session-search-correlation.ts.

export const SESSION_SEARCH_STATUS = "session_search";

export interface SessionSearchSnippet {
	role?: string;
	text: string;
}

/** One matched session — the AGENT's own on-disk session id (a claude/codex/
 * pi transcript id or an opencode session row), NOT a bridge session row id;
 * like past-conversations.tsx, selecting one yields a copy-able `--resume`
 * command rather than a web navigation. */
export interface SessionSearchHit {
	cwd?: string;
	id: string;
	lastModified?: number;
	snippets: SessionSearchSnippet[];
	title: string;
}

/** A `session_search` reply: `{ results, partial? }` or `{ error }` — always
 * `requestId`. */
export interface SessionSearchDetail {
	error?: string;
	partial?: boolean;
	requestId: string;
	results?: SessionSearchHit[];
}

/** The resolved (caller-facing) result of one search request. */
export interface SessionSearchResult {
	hits: SessionSearchHit[];
	/** The CLI's scan was cut short (time box / caps) — matches may be missing. */
	partial: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnippet(value: unknown): value is SessionSearchSnippet {
	return isRecord(value) && typeof value.text === "string";
}

function toHit(value: unknown): SessionSearchHit | null {
	if (
		!(
			isRecord(value) &&
			typeof value.id === "string" &&
			typeof value.title === "string"
		)
	) {
		return null;
	}
	return {
		cwd: typeof value.cwd === "string" ? value.cwd : undefined,
		id: value.id,
		lastModified:
			typeof value.lastModified === "number" ? value.lastModified : undefined,
		snippets: Array.isArray(value.snippets)
			? value.snippets.filter(isSnippet)
			: [],
		title: value.title,
	};
}

/** Validates a `session_search` detail — `null` unless it carries the string
 * `requestId` correlation key; malformed hits are dropped, not fatal. */
export function parseSessionSearchDetail(
	detail: unknown
): SessionSearchDetail | null {
	if (!(isRecord(detail) && typeof detail.requestId === "string")) {
		return null;
	}
	return {
		error: typeof detail.error === "string" ? detail.error : undefined,
		partial: detail.partial === true,
		requestId: detail.requestId,
		results: Array.isArray(detail.results)
			? detail.results
					.map(toHit)
					.filter((hit): hit is SessionSearchHit => hit !== null)
			: undefined,
	};
}
