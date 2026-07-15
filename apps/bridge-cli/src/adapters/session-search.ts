// P4-T5: cross-session full-text search — the shared engine behind each
// adapter's `AgentHandle.searchSessions`. A `searchSessions {requestId,
// query}` control command is answered with ONE `session_search` status event
// (fs/git-style requestId correlation, single reply — results are small).
// Plain bounded Node scanning, no ripgrep dependency (the CLI ships as a
// standalone binary): the newest ≤SEARCH_FILE_CAP transcript files for THIS
// workspace are streamed line-by-line, matched as a case-insensitive LITERAL
// substring (never a regex built from user input), and the whole scan is
// time-boxed — an expired box marks the reply `partial: true` instead of
// hanging. This module holds the wire reply + snippet/caps layer; the JSONL
// scan engine lives in session-search-jsonl.ts, per-provider file discovery +
// line shapes in session-search-providers.ts (codex/pi/claude) and
// opencode-search.ts.

import type { EventSink } from "./session-history-files";

export const SESSION_SEARCH_STATUS = "session_search";

/** Newest transcript files examined per search (per provider). */
export const SEARCH_FILE_CAP = 100;
/** Sessions returned per search. */
export const SEARCH_SESSION_CAP = 20;
/** Snippets kept per matched session. */
export const SEARCH_SNIPPET_CAP = 3;
/** Wall-clock box on one whole scan — expiry ends it with `partial: true`. */
export const SEARCH_TIME_BOX_MS = 3000;

/** Character cap on one snippet, the match centered inside the window. */
const SNIPPET_MAX_CHARS = 160;
/** Byte budget for the serialized results — same relay-cap reasoning as
 * git-runner.ts's `MAX_STATUS_DETAIL_BYTES`. */
const MAX_RESULTS_DETAIL_BYTES = 24_000;
const HALF = 2;

const WHITESPACE_RUN = /\s+/g;

export interface SessionSearchSnippet {
	role?: string;
	text: string;
}

/** One matched session — mirrored by the web's parser copy in
 * `apps/web/src/components/bridge/session-search-events.ts`; keep in sync. */
export interface SessionSearchHit {
	cwd?: string;
	id: string;
	lastModified: number;
	snippets: SessionSearchSnippet[];
	title: string;
}

export interface SessionSearchOutcome {
	/** The time box expired (or the reply was byte-shrunk) before everything
	 * in scope was covered. */
	partial: boolean;
	results: SessionSearchHit[];
}

/** Case-insensitive literal-substring snippet: whitespace collapsed, the
 * first match centered in a ≤SNIPPET_MAX_CHARS window with `…` at cut edges.
 * `undefined` when `text` doesn't contain `query` at all. */
export function buildSnippet(text: string, query: string): string | undefined {
	const oneLine = text.replaceAll(WHITESPACE_RUN, " ").trim();
	const index = oneLine.toLowerCase().indexOf(query.toLowerCase());
	if (index === -1) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	if (oneLine.length <= SNIPPET_MAX_CHARS) {
		return oneLine;
	}
	const slack = Math.max(0, SNIPPET_MAX_CHARS - query.length);
	const start = Math.max(
		0,
		Math.min(
			index - Math.floor(slack / HALF),
			oneLine.length - SNIPPET_MAX_CHARS
		)
	);
	const end = Math.min(oneLine.length, start + SNIPPET_MAX_CHARS);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < oneLine.length ? "…" : "";
	return `${prefix}${oneLine.slice(start, end)}${suffix}`;
}

/** Halves the results list until its serialized size fits the detail budget —
 * mirrors git-runner.ts's `fitEntries`, same relay-cap reasoning. */
function fitResults(results: SessionSearchHit[]): {
	results: SessionSearchHit[];
	shrunk: boolean;
} {
	let fitted = results;
	while (
		fitted.length > 1 &&
		Buffer.byteLength(JSON.stringify(fitted), "utf8") > MAX_RESULTS_DETAIL_BYTES
	) {
		fitted = fitted.slice(0, Math.floor(fitted.length / HALF));
	}
	return { results: fitted, shrunk: fitted.length !== results.length };
}

/** The single success reply — byte-fit, `partial` also set when the fit had
 * to drop trailing hits. */
export function pushSessionSearch(
	events: EventSink,
	requestId: string,
	outcome: SessionSearchOutcome
): void {
	const fitted = fitResults(outcome.results);
	events.push({
		kind: "status",
		status: SESSION_SEARCH_STATUS,
		detail: {
			partial: outcome.partial || fitted.shrunk,
			requestId,
			results: fitted.results,
		},
	});
}

/** The failure reply — an `{ error }` detail with the same requestId, never a
 * thrown error (mirrors pushSessionListError). */
export function pushSessionSearchError(
	events: EventSink,
	requestId: string,
	error: unknown
): void {
	events.push({
		kind: "status",
		status: SESSION_SEARCH_STATUS,
		detail: {
			error: error instanceof Error ? error.message : String(error),
			requestId,
			results: [],
		},
	});
}

/** Builds one adapter's fire-and-forget `searchSessions(requestId, query)`:
 * blank queries settle immediately as empty results, `run` failures settle as
 * an error detail — never a thrown error into the command dispatch. */
export function makeSearchSessions(
	events: EventSink,
	run: (query: string) => Promise<SessionSearchOutcome>
): (requestId: string, query: string) => void {
	return (requestId: string, query: string): void => {
		const trimmed = query.trim();
		if (trimmed === "") {
			pushSessionSearch(events, requestId, { partial: false, results: [] });
			return;
		}
		run(trimmed)
			.then((outcome) => pushSessionSearch(events, requestId, outcome))
			.catch((error: unknown) =>
				pushSessionSearchError(events, requestId, error)
			);
	};
}
