import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { BridgeSessionRow } from "@/utils/api-types";
import { client, orpc } from "@/utils/orpc";
import { withSessionPolling } from "./local-agent-poll";
import { deriveLocalAgentStatus } from "./local-agent-status";

// P2-T2 (docs/local-agent-workspace-plan.md): the workspace sidebar's session
// data — the polled FIRST page (fresh attention/status, shared cache with the
// /local list) plus manually accumulated older pages behind "Load more".
// Older pages are static snapshots: their attention hint may go stale, which
// is fine — anything old enough to live past page one isn't "working" anyway.

/** Merges the polled first page with the loaded older pages, deduping by id.
 * First-page rows win (they're the fresh, polled copies), so a session that
 * drifted across the page boundary between fetches never shadows its own
 * fresher row. Order: first page as-is, then older rows in load order. */
export function mergeSessionPages(
	firstPage: BridgeSessionRow[],
	olderPages: BridgeSessionRow[]
): BridgeSessionRow[] {
	const seen = new Set(firstPage.map((session) => session.id));
	const merged = [...firstPage];
	for (const session of olderPages) {
		if (!seen.has(session.id)) {
			seen.add(session.id);
			merged.push(session);
		}
	}
	return merged;
}

/** Which of `sessions` (newest-first) the workspace shows: the `?session=` id
 * when it names a known session, otherwise the newest. With no explicit pick
 * in the URL this keeps FOLLOWING the newest session — same semantics as the
 * old `useSessionSelection`, but with the URL as the single source of truth. */
export function pickActiveSession(
	sessions: BridgeSessionRow[],
	urlSessionId: string | null | undefined
): BridgeSessionRow | null {
	if (urlSessionId) {
		const match = sessions.find((session) => session.id === urlSessionId);
		if (match) {
			return match;
		}
	}
	return sessions[0] ?? null;
}

/** The sidebar row's single status signal, most-urgent first: an open
 * approval outranks "working", which outranks plain liveness. Ended sessions
 * never show attention (the server shouldn't emit it for them, but the tail
 * heuristic is best-effort, so gate here too). */
export type SessionSignal =
	| "approval"
	| "processing"
	| "live"
	| "idle"
	| "ended";

export function deriveSessionSignal(
	session: BridgeSessionRow,
	now: Date = new Date()
): SessionSignal {
	if (session.status !== "ended") {
		if (session.attention === "approval") {
			return "approval";
		}
		if (session.attention === "processing") {
			return "processing";
		}
	}
	return deriveLocalAgentStatus(session, now);
}

interface OlderPages {
	nextCursor: string | null;
	rows: BridgeSessionRow[];
}

/** First page polled at the shared cadence; older pages appended on demand
 * (one fetch per "Load more", never re-polled). `nextCursor` follows the last
 * loaded page once any older page exists — before that, the first page's.
 * Scoped to one bridge token so "Load more" pages through THIS agent's
 * history, not the user's interleaved sessions across all agents. */
export function useWorkspaceSessions(tokenId: string) {
	const firstPage = useQuery(
		withSessionPolling(
			orpc.bridge.listSessions.queryOptions({ input: { tokenId } })
		)
	);
	const [older, setOlder] = useState<OlderPages | null>(null);
	const loadMoreMutation = useMutation({
		mutationFn: (cursor: string) =>
			client.bridge.listSessions({ cursor, tokenId }),
		onSuccess: (page) => {
			setOlder((previous) => ({
				nextCursor: page.nextCursor,
				rows: mergeSessionPages(previous?.rows ?? [], page.sessions),
			}));
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const firstPageSessions = firstPage.data?.sessions;
	const olderRows = older?.rows;
	const sessions = useMemo(
		() => mergeSessionPages(firstPageSessions ?? [], olderRows ?? []),
		[firstPageSessions, olderRows]
	);
	const nextCursor = older
		? older.nextCursor
		: (firstPage.data?.nextCursor ?? null);

	const loadMore = () => {
		if (nextCursor && !loadMoreMutation.isPending) {
			loadMoreMutation.mutate(nextCursor);
		}
	};

	return {
		hasMore: nextCursor !== null,
		isLoadingMore: loadMoreMutation.isPending,
		isPending: firstPage.isPending,
		loadMore,
		sessions,
	};
}
