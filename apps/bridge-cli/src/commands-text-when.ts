// The text command + its optional busy-turn `when` (R3-T1) and image
// references (P3-T2) — split out of commands.ts purely to keep that file
// under the repo's 300-line file cap (same precedent as commands-question.ts).

import type { TextWhen } from "./adapters/types";
import { isRecord } from "./normalize/types";

/** P3-T2: one image reference riding a text command — points at an
 * already-uploaded server-side attachment (`bridge.uploadBridgeAttachment`)
 * the CLI downloads via `bridge.getBridgeAttachment` at dispatch time. The
 * wire counterpart of the DOWNLOADED `AgentImage` (adapters/types.ts). */
export interface ImageRef {
	id: string;
	mime: string;
	name: string;
}

/** A plain-text command to feed to the agent via `send` (or `sendWith` when
 * `when` requests non-default busy handling). Absent `when` — a bare string,
 * `{ text }`, or an unrecognized value — means "queue", the always-safe
 * default. */
export interface TextCommand {
	images?: ImageRef[];
	text: string;
	type: "text";
	when?: TextWhen;
}

const TEXT_WHEN_VALUES: readonly TextWhen[] = ["queue", "steer", "interrupt"];

function parseTextWhen(value: unknown): TextWhen | undefined {
	return typeof value === "string" &&
		(TEXT_WHEN_VALUES as readonly string[]).includes(value)
		? (value as TextWhen)
		: undefined;
}

function isImageRef(value: unknown): value is ImageRef {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.mime === "string" &&
		typeof value.name === "string"
	);
}

/** P3-T2: the well-formed `ImageRef`s out of a raw `images` value — an
 * absent/empty/non-array value (or one with no valid entry) degrades to
 * `undefined` (a plain text command), never a rejected parse, mirroring how
 * an unrecognized `when` degrades to "queue". */
function parseImageRefs(value: unknown): ImageRef[] | undefined {
	if (!Array.isArray(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const refs = value.filter(isImageRef);
	return refs.length > 0 ? refs : undefined;
}

/** Builds a `TextCommand` from a bare `text` plus whatever raw `when`/`images`
 * values (if any) rode along with it — `parseCommandText`'s (commands.ts)
 * shared final step for both the bare-string and `{ text, when?, images? }`
 * shapes. Unrecognized values degrade (see `parseTextWhen`/`parseImageRefs`),
 * never reject. */
export function parseTextCommand(
	text: string,
	whenValue: unknown,
	imagesValue?: unknown
): TextCommand {
	const command: TextCommand = { text, type: "text" };
	const when = parseTextWhen(whenValue);
	if (when) {
		command.when = when;
	}
	const images = parseImageRefs(imagesValue);
	if (images) {
		command.images = images;
	}
	return command;
}
