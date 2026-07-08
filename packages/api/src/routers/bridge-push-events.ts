import type { Context } from "../context";
import { maybePersistAgentSessionId } from "./bridge-agent-session-id";
import { maybeRecordBridgeUsage } from "./bridge-record-usage";

// Split out of bridge.ts purely to keep that file under the repo's
// max-lines-per-file gate.

/** Relay-appends each pushed event under its own server-assigned seq, running
 * the event's best-effort side effects (agentSessionId capture, turn_usage
 * dual-write into usage_records) along the way, then returns the persisted
 * rows for `persistEventsBestEffort`'s batched bridge_messages write. */
export async function appendPushedEvents(
	context: Context,
	sessionId: string,
	userId: string,
	events: unknown[]
): Promise<{ seq: number; event: unknown }[]> {
	const persisted: { seq: number; event: unknown }[] = [];
	for (const event of events) {
		const seq = await context.services.relayStore.append(
			sessionId,
			"events",
			event
		);
		persisted.push({ seq, event });
		await maybePersistAgentSessionId(context, sessionId, event);
		await maybeRecordBridgeUsage({ context, userId, sessionId, seq, event });
	}
	return persisted;
}
