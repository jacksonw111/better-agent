import { log } from "evlog";
import type { Context } from "../context";
import { maybePersistAgentSessionId } from "./bridge-agent-session-id";
import { maybeRecordBridgeUsage } from "./bridge-record-usage";
import { maybePersistSessionInfo } from "./bridge-session-info";

// Split out of bridge.ts purely to keep that file under the repo's
// max-lines-per-file gate.

/** Relay-appends each pushed event under its own server-assigned seq, running
 * the event's best-effort side effects (agentSessionId capture, turn_usage
 * dual-write into usage_records) along the way, then returns the persisted
 * rows for `persistEventsBestEffort`'s batched bridge_messages write.
 *
 * `idempotencyKeys[i]`, when present, is the CLI's client-minted key for
 * `events[i]` (see `apps/bridge-cli/src/relay-client.ts`'s `QueuedEvent`) —
 * stable across the push-queue's retries of a batch. `relayStore.append`
 * dedups on it, and a duplicate (`isNew: false` — this event was already
 * appended by an earlier call) is skipped entirely here: no bridge_messages
 * row (which has no unique constraint on seq — a second insert would be a
 * real duplicate row, not just a relay-window one) and no re-run of the
 * per-event side effects. This is T1 (see
 * `docs/remote-control-redesign-plan.md`) — the general fix for the same
 * class of bug the `turn_usage` dedupKey (`maybeRecordBridgeUsage`) patched
 * one-off. */
export async function appendPushedEvents(
	context: Context,
	sessionId: string,
	userId: string,
	events: unknown[],
	idempotencyKeys?: string[]
): Promise<{ seq: number; event: unknown }[]> {
	const persisted: { seq: number; event: unknown }[] = [];
	for (const [index, event] of events.entries()) {
		const { id: seq, isNew } = await context.services.relayStore.append(
			sessionId,
			"events",
			event,
			idempotencyKeys?.[index]
		);
		// Loss-audit instrumentation: pairs with the web's `web.gap`/`web.drop`
		// traces (event-feed.ts) to localize where a seq went missing.
		log.debug({ action: "server.assign", sessionId, seq, isNew });
		if (!isNew) {
			continue;
		}
		persisted.push({ seq, event });
		await maybePersistAgentSessionId(context, sessionId, event);
		await maybePersistSessionInfo(context, sessionId, event);
		await maybeRecordBridgeUsage({ context, userId, sessionId, seq, event });
	}
	return persisted;
}
