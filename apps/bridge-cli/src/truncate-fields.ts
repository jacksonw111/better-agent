// Field-level, byte-budget truncation for a single `NormalizedEvent` — the
// per-kind text shrinking `truncate-event.ts` orchestrates. Split out of
// truncate-event.ts to keep both files under the repo's per-file line cap.
//
// Everything here counts UTF-8 *bytes*, not characters: CJK text is ~3
// bytes/char and an emoji is a 4-byte code point, so a character-count cap
// under-measures multi-byte text badly — the very bug this module's byte
// awareness fixes. Cuts land only on code-point boundaries, so a multi-byte
// character is never split into an invalid half (no mojibake, no lone
// surrogate).

import type {
	ApprovalEvent,
	ApprovalOption,
	ErrorEvent,
	FileEvent,
	MessageEvent,
	NormalizedEvent,
	OutputEvent,
	StatusEvent,
	ToolEvent,
} from "./normalize/types";

/** UTF-8 BYTE budget for any single text-bearing field before it's truncated —
 * byte-based, not character-based, so multi-byte text (CJK ≈ 3 bytes/char,
 * emoji = 4-byte code points) is measured for what it actually costs on the
 * wire. Derived from the server's `MAX_EVENT_BYTES` (262_144) minus ~14 KiB of
 * headroom for JSON structural overhead (field names, braces, quotes), the
 * truncation marker, and modest string-escaping inflation — so a single
 * text-field event whose field is capped here lands comfortably under the
 * server cap. Events with SEVERAL large text fields (or adversarial
 * all-escaped content that inflates past the headroom) are caught by the
 * byte-size check in `truncateEvent`, which re-truncates with a tighter budget
 * — see `refitOversizedEvent`. */
export const MAX_EVENT_TEXT_BYTES = 248_000;

/** UTF-8 byte budget for an `ApprovalEvent`'s `title`/`detail`/each option's
 * `label`. Deliberately far more aggressive than `MAX_EVENT_TEXT_BYTES`: unlike
 * a chatty text field, an approval also carries a structured `options[]` array,
 * so every text field on it needs a tight, combinable cap — sized so that even
 * `MAX_APPROVAL_OPTIONS` options, each with a title/detail/label at this many
 * bytes, still fit well under `MAX_EVENT_BYTES`. Byte-based (not char-based) so
 * the guarantee holds even for all-multi-byte text. This is what lets
 * `truncateApprovalEvent` guarantee an approval never has to degrade wholesale
 * — see `truncateEvent`. */
const MAX_APPROVAL_FIELD_BYTES = 4000;

/** Longest prefix of `value` whose UTF-8 encoding is ≤ `maxBytes`, cut only on
 * a code-point boundary so a multi-byte character (CJK = 3 bytes, an emoji = a
 * 4-byte astral code point) is NEVER split into an invalid half. Returns
 * `value` unchanged when it already fits. Iterating with `for…of` walks by
 * Unicode code point (surrogate pairs stay whole), so the result is always
 * valid UTF-8 — no mojibake, no lone surrogate. */
function clampToByteBudget(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) {
		return value;
	}
	let usedBytes = 0;
	let endUnits = 0;
	for (const codePoint of value) {
		const codePointBytes = Buffer.byteLength(codePoint, "utf8");
		if (usedBytes + codePointBytes > maxBytes) {
			break;
		}
		usedBytes += codePointBytes;
		endUnits += codePoint.length;
	}
	return value.slice(0, endUnits);
}

/** Appends the `… [+N chars truncated]` marker to a truncated `head`, where N
 * is how many UTF-16 units of `original` were dropped — a human-readable count,
 * not part of the byte budget. */
function withTruncationMarker(head: string, original: string): string {
	const droppedChars = original.length - head.length;
	return `${head}… [+${droppedChars} chars truncated]`;
}

/** Truncates `value` to a UTF-8 BYTE budget (not a character count), cutting
 * only on code-point boundaries, and appends the dropped-chars marker. The
 * primitive the whole byte-budget scheme is built on: CJK is ~3 bytes/char, so
 * a field well under any sane character count can still be far over the
 * server's byte cap. Returns `value` unchanged when it already fits. */
export function truncateStringToBytes(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) {
		return value;
	}
	return withTruncationMarker(clampToByteBudget(value, maxBytes), value);
}

/** Truncates a general text field to `MAX_EVENT_TEXT_BYTES` (or a tighter
 * `maxBytes` when `truncateEvent`'s backstop re-truncates a still-oversized
 * event). */
function truncateString(
	value: string,
	maxBytes: number = MAX_EVENT_TEXT_BYTES
): string {
	return truncateStringToBytes(value, maxBytes);
}

/** Truncates an `ApprovalEvent` text field (`title`/`detail`/an option's
 * `label`) to the tighter `MAX_APPROVAL_FIELD_BYTES` cap — see that const for
 * why approvals need a more aggressive per-field limit. */
function truncateApprovalField(value: string): string {
	return truncateStringToBytes(value, MAX_APPROVAL_FIELD_BYTES);
}

/** Truncates a text-bearing field typed `unknown` (a tool's `input`/`output`,
 * a status/error event's `detail`): only strings are ever this long in
 * practice (structured payloads are left alone here and caught, if they push
 * the whole event over the byte cap, by `truncateEvent`'s final check). */
function truncateUnknownField(value: unknown, maxBytes: number): unknown {
	return typeof value === "string" ? truncateString(value, maxBytes) : value;
}

/** Shared by `MessageEvent` and `OutputEvent` — both are just a `text`
 * field alongside their discriminant. */
function truncateTextEvent<T extends MessageEvent | OutputEvent>(
	event: T,
	maxBytes: number
): T {
	const text = truncateString(event.text, maxBytes);
	return text === event.text ? event : { ...event, text };
}

function truncateToolEvent(event: ToolEvent, maxBytes: number): ToolEvent {
	const input = truncateUnknownField(event.input, maxBytes);
	const output = truncateUnknownField(event.output, maxBytes);
	return input === event.input && output === event.output
		? event
		: { ...event, input, output };
}

function truncateFileEvent(event: FileEvent, maxBytes: number): FileEvent {
	const diff =
		event.diff === undefined
			? event.diff
			: truncateString(event.diff, maxBytes);
	const path = truncateString(event.path, maxBytes);
	return diff === event.diff && path === event.path
		? event
		: { ...event, diff, path };
}

function truncateStatusEvent(
	event: StatusEvent,
	maxBytes: number
): StatusEvent {
	const detail = truncateUnknownField(event.detail, maxBytes);
	return detail === event.detail ? event : { ...event, detail };
}

function truncateErrorEvent(event: ErrorEvent, maxBytes: number): ErrorEvent {
	const message = truncateString(event.message, maxBytes);
	const detail = truncateUnknownField(event.detail, maxBytes);
	return message === event.message && detail === event.detail
		? event
		: { ...event, detail, message };
}

function truncateApprovalOption(option: ApprovalOption): ApprovalOption {
	const label = truncateApprovalField(option.label);
	return label === option.label ? option : { ...option, label };
}

/** Truncates every option's `label`. Returns `options` unchanged (same array
 * identity) if none of them needed it. */
function truncateApprovalOptions(options: ApprovalOption[]): ApprovalOption[] {
	const truncated = options.map(truncateApprovalOption);
	const anyChanged = truncated.some(
		(option, index) => option !== options[index]
	);
	return anyChanged ? truncated : options;
}

function truncateApprovalEvent(event: ApprovalEvent): ApprovalEvent {
	const title = truncateApprovalField(event.title);
	const detail =
		event.detail === undefined
			? event.detail
			: truncateApprovalField(event.detail);
	const options = truncateApprovalOptions(event.options);
	return title === event.title &&
		detail === event.detail &&
		options === event.options
		? event
		: { ...event, detail, options, title };
}

/** Dispatches to the per-kind truncation function above, each capping its text
 * fields at `maxBytes`. Kept as a plain dispatch table (no per-case logic of
 * its own) so its cyclomatic complexity stays low regardless of how many
 * `NormalizedEvent` kinds exist. */
export function truncateEventFields(
	event: NormalizedEvent,
	maxBytes: number
): NormalizedEvent {
	switch (event.kind) {
		case "message":
		case "output":
			return truncateTextEvent(event, maxBytes);
		case "tool":
			return truncateToolEvent(event, maxBytes);
		case "file":
			return truncateFileEvent(event, maxBytes);
		case "status":
			return truncateStatusEvent(event, maxBytes);
		case "error":
			return truncateErrorEvent(event, maxBytes);
		case "approval":
			return truncateApprovalEvent(event);
		default:
			return event;
	}
}
