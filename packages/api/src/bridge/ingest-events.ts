import { log } from "evlog";
import type { Context } from "../context";
import { appendPushedEvents } from "../routers/bridge-push-events";
import { assertEventsWithinSizeLimit } from "../routers/bridge-size-limits";

// Shared event-ingest core, used by BOTH the oRPC `pushEvents` handler
// (bridge.ts) and the WS `events` frame handler (ws-session.ts) — pulled out
// of bridge.ts so a single implementation backs both transports (spec: R0-T1
// of the WS transport refactor). Ownership (`requireOwnedBridgeSession`)
// stays the CALLER's responsibility: pushEvents already checks it before its
// handler body runs, and a WS connection checks it once at `hello` time
// (ws-session.ts) rather than re-checking on every `events` frame.

/** Max events accepted in a single ingest call (spec §3.1: bounded window).
 * The oRPC `pushEvents` procedure also enforces this via its zod schema
 * (`z.array(...).max(MAX_PUSH_BATCH)`) before its handler even runs; it's
 * re-checked here too because the WS `events` frame has no such schema gate
 * upstream of this function. */
export const MAX_PUSH_BATCH = 50;

export interface IngestEventsInput {
	events: unknown[];
	/** The CLI's client-minted idempotency key per event, aligned by index
	 * with `events`. Optional so a caller that doesn't send them still
	 * ingests — those events simply get no dedup (the pre-T1 HTTP
	 * behavior). The WS frame protocol always sends one, though. */
	idempotencyKeys?: string[];
	sessionId: string;
	userId: string;
}

/** Best-effort persistence of an ingested batch as one multi-row insert —
 * logged and swallowed, since a failure must never break the live relay. */
async function persistEventsBestEffort(
	context: Context,
	sessionId: string,
	rows: { seq: number; event: unknown }[]
): Promise<void> {
	try {
		await context.services.stores.bridgeMessage.appendMany(sessionId, rows);
	} catch (err) {
		log.error({ action: "bridge ingestEvents persist", error: String(err) });
	}
}

/** Throws when `input`'s shape violates the ingest contract — mirrors what
 * `pushEvents`'s zod schema (batch cap + refine) enforces at the oRPC layer,
 * so the WS path (which has no such schema) gets the same guarantees. */
function assertIngestShape(input: IngestEventsInput): void {
	if (input.events.length > MAX_PUSH_BATCH) {
		throw new Error(`events exceeds max batch of ${MAX_PUSH_BATCH}`);
	}
	if (
		input.idempotencyKeys !== undefined &&
		input.idempotencyKeys.length !== input.events.length
	) {
		throw new Error("idempotencyKeys must align 1:1 with events");
	}
}

/** Validates, relay-appends (dir "events"), best-effort persists, and touches
 * the session's liveness timestamp — the full body of what used to be
 * inlined in the `pushEvents` oRPC handler. Callers still own their own
 * ownership check (see this file's doc comment). */
export async function ingestEvents(
	context: Context,
	input: IngestEventsInput
): Promise<void> {
	assertIngestShape(input);
	assertEventsWithinSizeLimit(input.events);
	const persisted = await appendPushedEvents(
		context,
		input.sessionId,
		input.userId,
		input.events,
		input.idempotencyKeys
	);
	await persistEventsBestEffort(context, input.sessionId, persisted);
	await context.services.stores.bridgeSession.touch(input.sessionId);
}
