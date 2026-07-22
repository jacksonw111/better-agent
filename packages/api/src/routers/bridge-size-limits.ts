import { ORPCError } from "@orpc/server";

// Server-side size caps for the local agent bridge (spec §3.1: truncate
// oversized lines + bound the window). Extracted from the bridge router so the
// router file stays under the per-file line cap.

/** Max serialized size (bytes) of a single pushed event before it's rejected.
 * Mirrored in `apps/bridge-cli/src/truncate-status-shrink.ts`'s
 * `MAX_EVENT_BYTES` — the CLI keeps events (comfortably) under this same cap
 * before ever sending one here, so real oversized batches shouldn't happen in
 * practice. Keep the two values in sync.
 *
 * Raised from the original 32_768 to 262_144 (256 KiB): the 32 KB value was a
 * Cloudflare-Workers-era conservative guess that no longer applies now the
 * bridge runs under Docker with a jsonb store that handles hundreds of MB. The
 * only real cost of a bigger event is relay-window memory (the replay window
 * holds `MAX_WINDOW` = 500 events/session in memory — worst case
 * 500 × 256 KiB ≈ 128 MiB/session, never approached in practice), and the
 * payoff is that ordinary long output flows through instead of being truncated.
 * See truncate-status-shrink.ts for the full rationale. */
const MAX_EVENT_BYTES = 262_144;
/** Max size (characters) of sendInput's `data` before it's rejected. Raised
 * from the original 8192 to 100_000 so a user pasting a long task brief (a
 * multi-page spec, a big block of Chinese prose) isn't rejected — 8 K chars was
 * too tight for real prompts. Well within the event byte cap once relayed. */
const MAX_INPUT_CHARS = 100_000;

/** Serialized size of `value` in UTF-8 bytes, as JSON. */
function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Serialized size of `value` in characters: raw length for a string,
 * JSON length otherwise. */
function charSizeOf(value: unknown): number {
	if (typeof value === "string") {
		return value.length;
	}
	return (JSON.stringify(value) ?? "").length;
}

/** Rejects the whole call with BAD_REQUEST naming the first oversized event,
 * rather than silently truncating — real line-truncation belongs in the
 * CLI's adapters, which know how to shrink an event without corrupting it. */
export function assertEventsWithinSizeLimit(events: readonly unknown[]): void {
	for (const [index, event] of events.entries()) {
		if (byteSizeOf(event) > MAX_EVENT_BYTES) {
			throw new ORPCError("BAD_REQUEST", {
				message: `Event at index ${index} exceeds ${MAX_EVENT_BYTES} bytes`,
			});
		}
	}
}

export function assertInputWithinSizeLimit(data: unknown): void {
	if (charSizeOf(data) > MAX_INPUT_CHARS) {
		throw new ORPCError("BAD_REQUEST", {
			message: `sendInput data exceeds ${MAX_INPUT_CHARS} characters`,
		});
	}
}
