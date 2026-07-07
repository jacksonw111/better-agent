import { ORPCError } from "@orpc/server";
import type { Context } from "../context";

// requireOwnedBridgeSession is on the hot path (pushEvents/pollCommands poll
// every 0.5-2s per connected agent; observe/history/sendInput poll almost as
// often), and a bridge session's owner is immutable for its whole life — set
// once at creation, never reassigned. So once we've verified ownership for a
// sessionId we can trust it for as long as the process lives, skipping the
// DB round trip on every subsequent call. Bounded FIFO map: sessionId ->
// owning userId; oldest entry evicted once the cap is hit.
const MAX_CACHED_OWNERS = 10_000;
const ownerCache = new Map<string, string>();

function cacheOwner(sessionId: string, userId: string): void {
	if (!ownerCache.has(sessionId) && ownerCache.size >= MAX_CACHED_OWNERS) {
		const oldestKey = ownerCache.keys().next().value;
		if (oldestKey !== undefined) {
			ownerCache.delete(oldestKey);
		}
	}
	ownerCache.set(sessionId, userId);
}

function notFound(sessionId: string) {
	return new ORPCError("NOT_FOUND", {
		message: `Bridge session ${sessionId} not found`,
	});
}

/** Test-only escape hatch: the cache is module-level (shared across every
 * request in the process), so tests that reuse a sessionId across different
 * simulated owners need to reset it between cases. */
export function __resetOwnedBridgeSessionCacheForTests(): void {
	ownerCache.clear();
}

// Asserts `sessionId` belongs to `userId`. NOT_FOUND for both missing and
// other-owner sessions, so existence never leaks — same pattern as
// requireOwnedAgent / requireOwnedSession in the other routers.
//
// On a cache hit this never touches the DB, so it does NOT re-verify the
// session still exists — only that the previously-verified owner still
// matches. That's safe because ownership can't change out from under a
// cached entry; if the session was since deleted, the caller's next store
// call (e.g. bridgeMessage.append, relayStore.append) simply 404s/no-ops on
// the now-missing row instead of this check catching it earlier.
export async function requireOwnedBridgeSession(
	context: Context,
	userId: string,
	sessionId: string
): Promise<void> {
	const cachedOwnerId = ownerCache.get(sessionId);
	if (cachedOwnerId !== undefined) {
		if (cachedOwnerId !== userId) {
			throw notFound(sessionId);
		}
		return;
	}
	const session = await context.services.stores.bridgeSession.get(sessionId);
	if (!session || session.userId !== userId) {
		throw notFound(sessionId);
	}
	cacheOwner(sessionId, session.userId);
}
