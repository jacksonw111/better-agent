// Adapter-side output truncation — the one choke point (wired into
// `relay-client.ts`'s `runBridgeSession`, upstream of every adapter's own
// `AgentHandle.events`) that keeps a single chatty agent line (e.g. a huge
// file dump piped to stdout) from ever tripping the server's per-event byte
// cap. See `MAX_EVENT_BYTES` in `packages/api/src/routers/bridge.ts`, which
// rejects the *whole* pushEvents batch outright instead of truncating —
// real shrinking has to happen here, before the event is ever sent.

import {
	type ApprovalEvent,
	type ApprovalOption,
	type ErrorEvent,
	type FileEvent,
	isRecord,
	type MessageEvent,
	type NormalizedEvent,
	type OutputEvent,
	type StatusEvent,
	type ToolEvent,
} from "./normalize/types";

/** Max length (characters) of any single text-bearing field before it's
 * truncated. Comfortably under the server's 32_768-byte `MAX_EVENT_BYTES`
 * cap even once UTF-8 multi-byte characters and JSON-string-escaping
 * overhead are taken into account for a single field on its own — see
 * `MAX_EVENT_BYTES` below for the belt-and-suspenders check that covers the
 * case where *several* of an event's fields are each independently under
 * this cap but still add up to more than the server allows. */
export const MAX_EVENT_TEXT_CHARS = 16_000;

/** Mirrors `MAX_EVENT_BYTES` in `packages/api/src/routers/bridge.ts` — kept
 * as a local copy (bridge-cli and the api package don't share a runtime
 * constants module) so `truncateEvent` can detect an event that's still
 * oversized after every field has been truncated (e.g. a tool event whose
 * input *and* output are each independently under `MAX_EVENT_TEXT_CHARS`,
 * but not both at once) and degrade it instead of letting the server
 * reject the batch. Keep the two values in sync. */
const MAX_EVENT_BYTES = 32_768;

/** `status` value an oversized event degrades to once truncating its own
 * fields still isn't enough — see `truncateEvent`. Never applied to
 * `ApprovalEvent`s: see `MAX_APPROVAL_FIELD_CHARS`/`MAX_APPROVAL_OPTIONS`. */
const EVENT_TRUNCATED_STATUS = "event_truncated";

/** Max length (characters) of an `ApprovalEvent`'s `title`/`detail`/each
 * option's `label`. Deliberately far more aggressive than
 * `MAX_EVENT_TEXT_CHARS`: unlike a chatty text field, an approval also carries
 * a structured `options[]` array, so every text field on it needs a tight,
 * combinable cap — sized so that even `MAX_APPROVAL_OPTIONS` options, each
 * with a title/detail/label at this length, still fit well under
 * `MAX_EVENT_BYTES` in the worst case (every character a 4-byte-UTF-8 astral
 * symbol). This is what lets `truncateApprovalEvent` guarantee an approval
 * never has to degrade wholesale — see `truncateEvent`. */
const MAX_APPROVAL_FIELD_CHARS = 1000;

/** Max number of `options[]` kept on an `ApprovalEvent` that's still over
 * `MAX_EVENT_BYTES` after every field is truncated to
 * `MAX_APPROVAL_FIELD_CHARS` (a pathologically long options list). Dropping
 * the tail of the list is safer than losing the whole approval request —
 * `requestId` and the rest of the fields survive, so the answer flow (see
 * `AgentHandle.answerApproval`) stays alive instead of hanging forever
 * waiting on a request the user never saw. */
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

/** Truncates `value` to `maxChars`, appending a marker noting how many
 * characters were dropped. Returns `value` unchanged if it's already short
 * enough. Shared by `truncateString` (the `MAX_EVENT_TEXT_CHARS` cap used for
 * most fields) and `truncateApprovalField` (the tighter
 * `MAX_APPROVAL_FIELD_CHARS` cap approval fields need). */
function truncateStringTo(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	const droppedChars = value.length - maxChars;
	const head = value.slice(0, maxChars);
	return `${head}… [+${droppedChars} chars truncated]`;
}

/** Truncates `value` to `MAX_EVENT_TEXT_CHARS`, appending a marker noting
 * how many characters were dropped. Returns `value` unchanged if it's
 * already short enough. */
function truncateString(value: string): string {
	return truncateStringTo(value, MAX_EVENT_TEXT_CHARS);
}

/** Truncates an `ApprovalEvent` text field (`title`/`detail`/an option's
 * `label`) to the tighter `MAX_APPROVAL_FIELD_CHARS` cap — see that const for
 * why approvals need a more aggressive per-field limit than
 * `truncateString`'s. */
function truncateApprovalField(value: string): string {
	return truncateStringTo(value, MAX_APPROVAL_FIELD_CHARS);
}

/** Truncates a text-bearing field typed `unknown` (a tool's `input`/`output`,
 * a status/error event's `detail`): only strings are ever this long in
 * practice (structured payloads are left alone here and caught, if they push
 * the whole event over the byte cap, by `truncateEvent`'s final check). */
function truncateUnknownField(value: unknown): unknown {
	return typeof value === "string" ? truncateString(value) : value;
}

/** Serialized size of `value` in UTF-8 bytes, as JSON — mirrors `byteSizeOf`
 * in `packages/api/src/routers/bridge.ts`. */
function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Shared by `MessageEvent` and `OutputEvent` — both are just a `text`
 * field alongside their discriminant. */
function truncateTextEvent<T extends MessageEvent | OutputEvent>(event: T): T {
	const text = truncateString(event.text);
	return text === event.text ? event : { ...event, text };
}

function truncateToolEvent(event: ToolEvent): ToolEvent {
	const input = truncateUnknownField(event.input);
	const output = truncateUnknownField(event.output);
	return input === event.input && output === event.output
		? event
		: { ...event, input, output };
}

function truncateFileEvent(event: FileEvent): FileEvent {
	const diff =
		event.diff === undefined ? event.diff : truncateString(event.diff);
	const path = truncateString(event.path);
	return diff === event.diff && path === event.path
		? event
		: { ...event, diff, path };
}

function truncateStatusEvent(event: StatusEvent): StatusEvent {
	const detail = truncateUnknownField(event.detail);
	return detail === event.detail ? event : { ...event, detail };
}

function truncateErrorEvent(event: ErrorEvent): ErrorEvent {
	const message = truncateString(event.message);
	const detail = truncateUnknownField(event.detail);
	return message === event.message && detail === event.detail
		? event
		: { ...event, message, detail };
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

/** Caps a still-oversized `ApprovalEvent`'s `options[]` at
 * `MAX_APPROVAL_OPTIONS`, dropping the tail — see that const. Only reached
 * for a pathologically long options list: `MAX_APPROVAL_FIELD_CHARS` already
 * guarantees `MAX_APPROVAL_OPTIONS` options fit under `MAX_EVENT_BYTES`, so
 * every other field-level truncation is enough on its own. */
function capApprovalOptionsEvent(event: ApprovalEvent): ApprovalEvent {
	if (byteSizeOf(event) <= MAX_EVENT_BYTES) {
		return event;
	}
	return { ...event, options: event.options.slice(0, MAX_APPROVAL_OPTIONS) };
}

/** Dispatches to the per-kind truncation function above. Kept as a plain
 * dispatch table (no per-case logic of its own) so its cyclomatic
 * complexity stays low regardless of how many `NormalizedEvent` kinds
 * exist. */
function truncateEventFields(event: NormalizedEvent): NormalizedEvent {
	switch (event.kind) {
		case "message":
		case "output":
			return truncateTextEvent(event);
		case "tool":
			return truncateToolEvent(event);
		case "file":
			return truncateFileEvent(event);
		case "status":
			return truncateStatusEvent(event);
		case "error":
			return truncateErrorEvent(event);
		case "approval":
			return truncateApprovalEvent(event);
		default:
			return event;
	}
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
	const truncated = truncateEventFields(value);
	if (truncated.kind === "approval") {
		return capApprovalOptionsEvent(truncated);
	}
	return byteSizeOf(truncated) <= MAX_EVENT_BYTES
		? truncated
		: degradeToTruncatedStatus(truncated);
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
