// The pi `prompt` stdin frame builder — split out of pi-commands.ts (which
// owns the other command builders + response parsers) to keep that file under
// the repo's 300-line limit after P3-T2 added image support here.

/** The values pi's `prompt` command accepts for `streamingBehavior` — see
 * `buildPiPromptCommand`'s doc comment (R2-T3 item 1, CRITICAL). ASSUMPTION
 * (unverified, no `pi` binary in this sandbox — per the brief's researched
 * rpc-types v0.80.6 shape): `"steer"` interrupts the current turn with this
 * message, `"followUp"` queues it behind the current turn. */
export type PiStreamingBehavior = "followUp" | "steer";

/** P3-T2: what a prompt image needs from the caller — structurally satisfied
 * by the adapter layer's `AgentImage` (adapters/types.ts, already downloaded
 * + base64'd by image-input.ts). Mapped onto pi's wire `ImageContent`
 * (`{type: "image", data, mimeType}`) below. */
export interface PiPromptImage {
	/** Base64-encoded image bytes (no data-URI prefix). */
	data: string;
	mimeType: string;
}

/**
 * Builds one `pi --mode rpc` stdin command for a user turn.
 *
 * CRITICAL (R2-T3 item 1): pi ERRORS on a bare `prompt` sent while it's still
 * streaming a turn — the adapter's streaming tracker (adapters/pi-streaming.ts)
 * must pass `"followUp"` (the safe, non-interrupting default) whenever a
 * `send()` lands mid-turn; `streamingBehavior` is omitted entirely (unchanged
 * from before this fix) for an idle send, and `"steer"` is supported for a
 * future mid-turn-redirect UI but never sent by this adapter today.
 *
 * P3-T2: `images` — VERIFIED against pi-mono's
 * packages/coding-agent/docs/rpc.md @ main (fetched 2026-07-14): `prompt`
 * takes an optional `images: [{"type": "image", "data": "<base64>",
 * "mimeType": "image/png"}]` (the `ImageContent` format), on every
 * `streamingBehavior` variant. Omitted entirely (byte-identical frame to
 * before P3-T2) when there are none.
 */
export function buildPiPromptCommand(
	text: string,
	streamingBehavior?: PiStreamingBehavior,
	images?: readonly PiPromptImage[]
): string {
	const frame: Record<string, unknown> = { type: "prompt", message: text };
	if (streamingBehavior !== undefined) {
		frame.streamingBehavior = streamingBehavior;
	}
	if (images && images.length > 0) {
		frame.images = images.map(({ data, mimeType }) => ({
			type: "image",
			data,
			mimeType,
		}));
	}
	return JSON.stringify(frame);
}
