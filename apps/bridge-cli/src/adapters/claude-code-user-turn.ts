import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentImage } from "./types";

// P3-T2: builds the SDK user turn — split out of claude-code.ts (which sits
// at the repo's 300-line cap) now that a turn can carry downloaded images as
// base64 content blocks alongside the text.

/** The `media_type` values the SDK's base64 image source accepts — exactly
 * the server's upload whitelist (`ALLOWED_IMAGE_MIME`,
 * packages/api/src/attachments.ts), so `toMediaType` below is a type
 * narrowing, not a real filter. */
const IMAGE_MEDIA_TYPES = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
] as const;

type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

function toMediaType(mime: string): ImageMediaType {
	return (IMAGE_MEDIA_TYPES as readonly string[]).includes(mime)
		? (mime as ImageMediaType)
		: "image/png";
}

function imageBlock(image: AgentImage) {
	return {
		type: "image" as const,
		source: {
			type: "base64" as const,
			media_type: toMediaType(image.mimeType),
			data: image.data,
		},
	};
}

/** A user turn for the SDK's streaming-input `query()`: a bare string when
 * there are no images (byte-identical to the pre-P3-T2 shape), otherwise a
 * content-block array of the text followed by one base64 image block per
 * downloaded image. */
export function userTurn(text: string, images?: AgentImage[]): SDKUserMessage {
	const content =
		images && images.length > 0
			? [{ type: "text" as const, text }, ...images.map(imageBlock)]
			: text;
	return {
		type: "user",
		message: { role: "user", content },
		parent_tool_use_id: null,
	};
}
