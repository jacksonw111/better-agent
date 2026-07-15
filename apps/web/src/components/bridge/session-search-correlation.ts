import type { StreamEvent } from "./bridge-events";
import {
	parseSessionSearchDetail,
	SESSION_SEARCH_STATUS,
	type SessionSearchResult,
} from "./session-search-events";

// P4-T5: request/response correlation for the search channel — the fs/git
// pattern (git-correlation.ts) applied to `searchSessions`: the web mints a
// `requestId`, sends it on the control command, and the CLI echoes it on the
// single `session_search` reply status event picked out of the feed here (no
// chunking — results are byte-fit CLI-side). Pure module (no React);
// use-session-search.ts owns the hook wiring.

/** The control-command sender (SessionControls.searchSessions) — requestId
 * first, mirroring the CLI's `CommandSink` method. */
export interface SessionSearchSender {
	search: (requestId: string, query: string) => Promise<void>;
}

export interface SessionSearchCorrelator {
	/** Rejects everything still pending — the publishing terminal unmounted. */
	dispose: () => void;
	/** Feed the NEW tail of the event feed (caller tracks the cursor). */
	ingest: (events: StreamEvent[]) => void;
	search: (query: string) => Promise<SessionSearchResult>;
}

/** Same timeout contract as fs/git — a reply landing later is dropped. */
export const SESSION_SEARCH_TIMEOUT_MS = 10_000;

export const SESSION_SEARCH_TIMEOUT_MESSAGE =
	"No reply from the CLI — try again.";
const DISPOSED_MESSAGE = "The session's search channel closed.";

interface Pending {
	reject: (error: Error) => void;
	resolve: (value: SessionSearchResult) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** Removes and returns `requestId`'s pending entry (clearing its timer). */
function settle(
	pendings: Map<string, Pending>,
	requestId: string
): Pending | undefined {
	const pending = pendings.get(requestId);
	if (pending) {
		pendings.delete(requestId);
		clearTimeout(pending.timer);
	}
	return pending;
}

function onSearchEvent(pendings: Map<string, Pending>, detail: unknown): void {
	const parsed = parseSessionSearchDetail(detail);
	const pending = parsed && settle(pendings, parsed.requestId);
	if (!(parsed && pending)) {
		return;
	}
	if (parsed.error !== undefined) {
		pending.reject(new Error(parsed.error));
		return;
	}
	pending.resolve({
		hits: parsed.results ?? [],
		partial: parsed.partial === true,
	});
}

export interface CreateSessionSearchCorrelatorArgs {
	/** Injectable id mint for deterministic tests. */
	mintId?: () => string;
	send: SessionSearchSender;
	timeoutMs?: number;
}

export function createSessionSearchCorrelator(
	args: CreateSessionSearchCorrelatorArgs
): SessionSearchCorrelator {
	const pendings = new Map<string, Pending>();
	const timeoutMs = args.timeoutMs ?? SESSION_SEARCH_TIMEOUT_MS;
	const mintId = args.mintId ?? (() => crypto.randomUUID());
	const search = (query: string): Promise<SessionSearchResult> => {
		const requestId = mintId();
		const promise = new Promise<SessionSearchResult>((resolve, reject) => {
			pendings.set(requestId, {
				reject,
				resolve,
				timer: setTimeout(() => {
					settle(pendings, requestId)?.reject(
						new Error(SESSION_SEARCH_TIMEOUT_MESSAGE)
					);
				}, timeoutMs),
			});
		});
		// A failed control send settles the request too — nothing will reply.
		args.send.search(requestId, query).catch(() => {
			settle(pendings, requestId)?.reject(
				new Error(SESSION_SEARCH_TIMEOUT_MESSAGE)
			);
		});
		return promise;
	};
	return {
		dispose: () => {
			for (const requestId of [...pendings.keys()]) {
				settle(pendings, requestId)?.reject(new Error(DISPOSED_MESSAGE));
			}
		},
		ingest: (events) => {
			for (const { event } of events) {
				if (event.kind === "status" && event.status === SESSION_SEARCH_STATUS) {
					onSearchEvent(pendings, event.detail);
				}
			}
		},
		search,
	};
}
