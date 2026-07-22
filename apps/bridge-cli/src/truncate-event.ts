// Adapter-side output truncation — the one choke point (wired into
// `relay-client.ts`'s `runBridgeSession`, upstream of every adapter's own
// `AgentHandle.events`) that keeps a single pathologically huge agent line from
// ever tripping the server's per-event byte cap. See `MAX_EVENT_BYTES` in
// `packages/api/src/routers/bridge-size-limits.ts`, which rejects the *whole*
// pushEvents batch outright instead of truncating — real shrinking has to
// happen here, before the event is ever sent.
//
// The cap is now 256 KiB (see `MAX_EVENT_BYTES`), so ordinary long output — a
// file dump, a long Chinese analysis a few tens of KB in size — flows through
// UNTOUCHED and never even reaches truncation. The per-field byte-budget
// shrinking lives in truncate-fields.ts; this file orchestrates it and decides
// when a still-oversized event must be re-truncated harder or (only for a
// purely-structural payload) degraded wholesale.

import {
	type ApprovalEvent,
	isRecord,
	type NormalizedEvent,
} from "./normalize/types";
import { MAX_EVENT_TEXT_BYTES, truncateEventFields } from "./truncate-fields";
import {
	byteSizeOf,
	MAX_EVENT_BYTES,
	shrinkOversizedStatusEvent,
} from "./truncate-status-shrink";

export { MAX_EVENT_TEXT_BYTES, truncateStringToBytes } from "./truncate-fields";
export { MAX_EVENT_BYTES } from "./truncate-status-shrink";

/** `status` value an oversized event degrades to once truncating its own
 * fields still isn't enough — see `truncateEvent`. Never applied to
 * `ApprovalEvent`s: see `MAX_APPROVAL_OPTIONS`. Exported (A2) so
 * forward-events-shed.ts's backlog-overflow marker reuses the exact status the
 * web already knows how to render. */
export const EVENT_TRUNCATED_STATUS = "event_truncated";

/** Max number of `options[]` kept on an `ApprovalEvent` that's still over
 * `MAX_EVENT_BYTES` after every field is truncated (a pathologically long
 * options list). Dropping the tail of the list is safer than losing the whole
 * approval request — `requestId` and the rest of the fields survive, so the
 * answer flow (see `AgentHandle.answerApproval`) stays alive instead of hanging
 * forever waiting on a request the user never saw. */
export const MAX_APPROVAL_OPTIONS = 8;

const NORMALIZED_EVENT_KINDS: ReadonlySet<NormalizedEvent["kind"]> = new Set([
	"message",
	"tool",
	"file",
	"output",
	"status",
	"error",
	"approval",
]);

/** Narrows an arbitrary relayed value down to a `NormalizedEvent` at
 * runtime. `truncateEvent` is called from the generic relay layer (see
 * `relay-client.ts`), which also carries plain values in tests — anything
 * that doesn't look like a normalized event passes through untouched. */
function isNormalizedEvent(value: unknown): value is NormalizedEvent {
	return (
		isRecord(value) &&
		typeof value.kind === "string" &&
		NORMALIZED_EVENT_KINDS.has(value.kind as NormalizedEvent["kind"])
	);
}

/** Caps a still-oversized `ApprovalEvent`'s `options[]` at
 * `MAX_APPROVAL_OPTIONS`, dropping the tail — see that const. Only reached
 * for a pathologically long options list: `MAX_APPROVAL_FIELD_BYTES` already
 * guarantees `MAX_APPROVAL_OPTIONS` options fit under `MAX_EVENT_BYTES`, so
 * every other field-level truncation is enough on its own. */
function capApprovalOptionsEvent(event: ApprovalEvent): ApprovalEvent {
	if (byteSizeOf(event) <= MAX_EVENT_BYTES) {
		return event;
	}
	return { ...event, options: event.options.slice(0, MAX_APPROVAL_OPTIONS) };
}

/** Smallest per-field byte budget `refitOversizedEvent` will try before giving
 * up — far below any real single field's needs, so reaching it means the
 * event's weight is structural (non-string) payload that text truncation can't
 * touch. */
const FALLBACK_MIN_TEXT_BYTES = 256;
const BUDGET_HALVING_DIVISOR = 2;

/** Re-truncates `event`'s text fields from scratch (from the ORIGINAL, so no
 * double markers) with an ever-tighter byte budget until the whole event fits
 * under `MAX_EVENT_BYTES`. This is what keeps any event carrying a string field
 * — a `message`/`output`/`error`, a `tool` with two huge string fields, an
 * adversarially all-escaped field — from EVER degrading to `event_truncated`:
 * as long as shrinking the text shrinks the event, some budget fits. Returns
 * `undefined` only when no budget helps — i.e. the event carries no truncatable
 * text and its structural payload alone is over the cap — so the caller
 * degrades it. */
function refitOversizedEvent(
	event: NormalizedEvent
): NormalizedEvent | undefined {
	let maxBytes = Math.floor(MAX_EVENT_TEXT_BYTES / BUDGET_HALVING_DIVISOR);
	while (maxBytes >= FALLBACK_MIN_TEXT_BYTES) {
		const candidate = truncateEventFields(event, maxBytes);
		if (byteSizeOf(candidate) <= MAX_EVENT_BYTES) {
			return candidate;
		}
		maxBytes = Math.floor(maxBytes / BUDGET_HALVING_DIVISOR);
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** Degrades an event that's still over `MAX_EVENT_BYTES` after field
 * truncation to a small, deterministically-sized status event instead of
 * trying to shrink a structured payload further. */
function degradeToTruncatedStatus(event: NormalizedEvent): NormalizedEvent {
	return {
		detail: { originalKind: event.kind },
		kind: "status",
		status: EVENT_TRUNCATED_STATUS,
	};
}

/**
 * Truncates `value`'s text-bearing fields so it can never trip the server's
 * `MAX_EVENT_BYTES` rejection. Non-normalized-event values (see
 * `isNormalizedEvent`) pass through untouched — the relay layer this is
 * wired into (`relay-client.ts`) is generic over its event type. A
 * normalized event with every field already short is returned as the exact
 * same object (no defensive copying) so short events pass through untouched.
 *
 * `ApprovalEvent`s never degrade wholesale (see `degradeToTruncatedStatus`):
 * losing `requestId`/`options` would leave the agent's approval flow hanging
 * forever with no way for the user to answer it, so an oversized approval is
 * shrunk instead via `capApprovalOptionsEvent`.
 */
export function truncateEvent(value: unknown): unknown {
	if (!isNormalizedEvent(value)) {
		return value;
	}
	const truncated = truncateEventFields(value, MAX_EVENT_TEXT_BYTES);
	if (truncated.kind === "approval") {
		return capApprovalOptionsEvent(truncated);
	}
	if (byteSizeOf(truncated) <= MAX_EVENT_BYTES) {
		return truncated;
	}
	// Control-plane statuses (`session_ready`, `command_catalog`) shrink
	// structurally instead of degrading — see truncate-status-shrink.ts.
	if (truncated.kind === "status") {
		const shrunk = shrinkOversizedStatusEvent(truncated);
		if (shrunk) {
			return shrunk;
		}
	}
	// Any event still over the cap that carries a truncatable text field is
	// re-truncated harder (byte budget halved until it fits) rather than
	// degraded — see refitOversizedEvent. Only a purely-structural oversized
	// payload (no string field to shrink) falls through to the opaque
	// `event_truncated` placeholder.
	return refitOversizedEvent(value) ?? degradeToTruncatedStatus(truncated);
}

/** Wraps `events` so every emitted value passes through `truncateEvent`
 * first — the single wiring point `runBridgeSession` (relay-client.ts) uses
 * to apply truncation uniformly to whichever adapter produced `events`,
 * without `forwardEvents` itself (which stays generic and untyped for
 * testability) needing to know anything about normalized events. */
export async function* truncateEvents(
	events: AsyncIterable<unknown>
): AsyncGenerator<unknown> {
	for await (const event of events) {
		yield truncateEvent(event);
	}
}
