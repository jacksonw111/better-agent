import {
	type UseMutationResult,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { BridgeSessionRow } from "@/utils/api-types";
import { client, orpc } from "@/utils/orpc";

// P3-T1 (docs/local-agent-workspace-plan.md): the sidebar's persisted session
// management — rename/star/archive/restore/hard-delete mutations plus the two
// pure list helpers (starred-first sort, post-removal selection). Every
// mutation invalidates the listSessions cache prefix so the polled first
// page, "Load more" snapshots AND the archived view all refetch together.

/** Starred sessions pinned to the top; recency preserved within each group
 * (the input is already newest-first). Stable sort, so nothing else moves. */
export function sortStarredFirst(
	sessions: BridgeSessionRow[]
): BridgeSessionRow[] {
	return [...sessions].sort((a, b) => Number(b.starred) - Number(a.starred));
}

/** Which session the workspace should select once `removedId` leaves the list
 * (archived or deleted): the newest remaining one — but only when the removed
 * session was the ACTIVE one; null otherwise (nothing to do) and null when
 * nothing remains (the workspace falls back to its waiting state). */
export function nextSessionAfterRemoval(
	sessions: BridgeSessionRow[],
	activeSessionId: string | null,
	removedId: string
): string | null {
	if (removedId !== activeSessionId) {
		return null;
	}
	return sessions.find((session) => session.id !== removedId)?.id ?? null;
}

type SessionMutation<TInput> = UseMutationResult<
	{ ok: boolean },
	Error,
	TInput
>;

export interface SessionActions {
	archive: SessionMutation<{ sessionId: string }>;
	deleteSession: SessionMutation<{ sessionId: string }>;
	rename: SessionMutation<{ sessionId: string; name: string | null }>;
	restore: SessionMutation<{ sessionId: string }>;
	star: SessionMutation<{ sessionId: string; starred: boolean }>;
}

/** The five persisted session mutations. `onRemoved` fires after a successful
 * archive/delete (the two actions that remove a row from the default list) so
 * the caller can move selection off the vanished session. */
export function useSessionActions(
	onRemoved?: (sessionId: string) => void
): SessionActions {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.bridge.listSessions.key() });
	const onError = (error: Error) => toast.error(error.message);
	const onRemovalSuccess = (
		_result: { ok: boolean },
		input: { sessionId: string }
	) => {
		invalidate();
		onRemoved?.(input.sessionId);
	};
	return {
		rename: useMutation({
			mutationFn: (input: { sessionId: string; name: string | null }) =>
				client.bridge.renameSession(input),
			onSuccess: invalidate,
			onError,
		}),
		star: useMutation({
			mutationFn: (input: { sessionId: string; starred: boolean }) =>
				client.bridge.starSession(input),
			onSuccess: invalidate,
			onError,
		}),
		archive: useMutation({
			mutationFn: (input: { sessionId: string }) =>
				client.bridge.archiveSession(input),
			onSuccess: onRemovalSuccess,
			onError,
		}),
		restore: useMutation({
			mutationFn: (input: { sessionId: string }) =>
				client.bridge.restoreSession(input),
			onSuccess: invalidate,
			onError,
		}),
		deleteSession: useMutation({
			mutationFn: (input: { sessionId: string }) =>
				client.bridge.deleteSession(input),
			onSuccess: onRemovalSuccess,
			onError,
		}),
	};
}
