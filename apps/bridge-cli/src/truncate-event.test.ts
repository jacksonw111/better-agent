import { describe, expect, it } from "vitest";
import type {
	ApprovalEvent,
	ApprovalOption,
	FileEvent,
	MessageEvent,
	OutputEvent,
	ToolEvent,
} from "./normalize/types";
import {
	MAX_APPROVAL_OPTIONS,
	MAX_EVENT_TEXT_BYTES,
	truncateEvent,
	truncateEvents,
} from "./truncate-event";

const MAX_EVENT_BYTES = 262_144;
/** The pre-raise 32 KiB cap — used to make the CJK-pass-through regression
 * explicit: these events would have degraded to `event_truncated` before the
 * cap was raised, and now flow through untouched. */
const OLD_EVENT_BYTES = 32_768;
const OVERFLOW_BYTES = 1000;
const NON_EVENT_NUMBER = 42;
const HUGE_APPROVAL_TEXT_CHARS = 50_000;
/** 12_000 short options ≈ 420 KiB — over the raised 256 KiB cap on count
 * alone, so the array itself must be capped. */
const PATHOLOGICAL_OPTION_COUNT = 12_000;
/** Enough CJK characters to blow past the OLD 32 KiB cap (3 bytes each) while
 * staying well under the raised 256 KiB one — the exact shape that used to be
 * degraded for heavy-CJK users. */
const CJK_COUNT_SMALL = 11_000;
const CJK_COUNT_LARGE = 16_000;
/** A structured (non-string) payload with no truncatable text field, sized
 * past the raised cap: ~60_000 integers ≈ 350 KiB of JSON. */
const STRUCTURAL_NUMBER_COUNT = 60_000;
const CJK_CHAR = "中";

function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function truncatesAnOverLongOutputEventsText(): void {
	const text = "a".repeat(MAX_EVENT_TEXT_BYTES + OVERFLOW_BYTES);
	const event: OutputEvent = { kind: "output", text };

	const result = truncateEvent(event) as OutputEvent;

	expect(result.kind).toBe("output");
	expect(result.text).toBe(
		`${"a".repeat(MAX_EVENT_TEXT_BYTES)}… [+${OVERFLOW_BYTES} chars truncated]`
	);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

function truncatesAnOverLongMessageEventsText(): void {
	const text = "b".repeat(MAX_EVENT_TEXT_BYTES + OVERFLOW_BYTES);
	const event: MessageEvent = { kind: "message", role: "assistant", text };

	const result = truncateEvent(event) as MessageEvent;

	expect(result.text.endsWith(`… [+${OVERFLOW_BYTES} chars truncated]`)).toBe(
		true
	);
	expect(result.text.length).toBeLessThan(text.length);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

/** Heavy-CJK output that clears the OLD 32 KiB cap but is comfortably under the
 * raised one now flows through UNTOUCHED (same object identity) — the whole
 * point of raising the cap. */
function passesThroughAModestCjkMessageUntouched(): void {
	const text = CJK_CHAR.repeat(CJK_COUNT_SMALL);
	const event: MessageEvent = { kind: "message", role: "assistant", text };

	expect(byteSizeOf(event)).toBeGreaterThan(OLD_EVENT_BYTES);
	expect(truncateEvent(event)).toBe(event);
}

function passesThroughALargerCjkMessageUntouched(): void {
	const text = CJK_CHAR.repeat(CJK_COUNT_LARGE);
	const event: MessageEvent = { kind: "message", role: "assistant", text };

	expect(byteSizeOf(event)).toBeGreaterThan(OLD_EVENT_BYTES);
	expect(truncateEvent(event)).toBe(event);
}

/** A tool event with TWO string fields each on its own over the byte budget:
 * primary field truncation caps each at MAX_EVENT_TEXT_BYTES, but two of those
 * still exceed the whole-event cap, so the backstop re-truncates harder — it
 * must stay a tool event (never degrade), since it carries truncatable text. */
function reTruncatesAToolEventWithTwoHugeStringFields(): void {
	const huge = "c".repeat(MAX_EVENT_TEXT_BYTES + OVERFLOW_BYTES);
	const event: ToolEvent = {
		id: "t1",
		input: huge,
		kind: "tool",
		name: "shell",
		output: huge,
		status: "completed",
	};

	const result = truncateEvent(event) as ToolEvent;

	expect(result.kind).toBe("tool");
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
	expect((result.input as string).length).toBeLessThan(huge.length);
	expect((result.output as string).length).toBeLessThan(huge.length);
}

/** A tool event whose weight is a STRUCTURED payload (a huge number array) with
 * no truncatable text field can't be shrunk by field truncation, so it's the
 * one case that still degrades wholesale — the backstop path is preserved. */
function degradesAPurelyStructuralOversizedEvent(): void {
	const input = Array.from({ length: STRUCTURAL_NUMBER_COUNT }, (_, i) => i);
	const event: ToolEvent = {
		id: "t2",
		input,
		kind: "tool",
		name: "shell",
		status: "completed",
	};

	expect(byteSizeOf(event)).toBeGreaterThan(MAX_EVENT_BYTES);
	const result = truncateEvent(event);

	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
	expect(result).toEqual({
		detail: { originalKind: "tool" },
		kind: "status",
		status: "event_truncated",
	});
}

/** Approvals must never degrade wholesale (see `degradeToTruncatedStatus`):
 * losing `requestId`/`options` would leave the agent's approval flow hanging
 * forever with no way for the user to answer it. A huge title alongside huge
 * option labels must still come back as a structurally valid approval. */
function keepsAHugeApprovalAliveAsAnApproval(): void {
	const options: ApprovalOption[] = [
		{ id: "opt-1", label: "y".repeat(HUGE_APPROVAL_TEXT_CHARS) },
		{ id: "opt-2", label: "z".repeat(HUGE_APPROVAL_TEXT_CHARS) },
	];
	const event: ApprovalEvent = {
		detail: "w".repeat(HUGE_APPROVAL_TEXT_CHARS),
		kind: "approval",
		options,
		requestId: "req-1",
		title: "x".repeat(HUGE_APPROVAL_TEXT_CHARS),
	};

	const result = truncateEvent(event) as ApprovalEvent;

	expect(result.kind).toBe("approval");
	expect(result.requestId).toBe("req-1");
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

/** A pathologically long `options[]` array (each label already short) can
 * still blow past the byte cap purely on count — the field-level truncation
 * in `truncateApprovalEvent` can't help there, so the array itself must be
 * capped at `MAX_APPROVAL_OPTIONS` while keeping `requestId`/`kind` intact. */
function capsAPathologicallyLongApprovalOptionsList(): void {
	const options: ApprovalOption[] = Array.from(
		{ length: PATHOLOGICAL_OPTION_COUNT },
		(_, index) => ({ id: `opt-${index}`, label: `option ${index}` })
	);
	const event: ApprovalEvent = {
		kind: "approval",
		options,
		requestId: "req-2",
		title: "pick one",
	};

	const result = truncateEvent(event) as ApprovalEvent;

	expect(result.kind).toBe("approval");
	expect(result.requestId).toBe("req-2");
	expect(result.options.length).toBeLessThanOrEqual(MAX_APPROVAL_OPTIONS);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

/** A file event's `path` is just as capable of overflowing as its `diff` —
 * it needs the same truncation treatment. */
function truncatesAFileEventsOverLongPathWithNoDiff(): void {
	const path = "/".repeat(MAX_EVENT_TEXT_BYTES + OVERFLOW_BYTES);
	const event: FileEvent = { change: "created", kind: "file", path };

	const result = truncateEvent(event) as FileEvent;

	expect(result.kind).toBe("file");
	expect(result.path.length).toBeLessThan(path.length);
	expect(byteSizeOf(result)).toBeLessThanOrEqual(MAX_EVENT_BYTES);
}

function leavesAShortEventUntouched(): void {
	const event: MessageEvent = {
		kind: "message",
		role: "assistant",
		text: "hello",
	};

	expect(truncateEvent(event)).toBe(event);
}

function passesThroughNonNormalizedEventValues(): void {
	expect(truncateEvent("plain string")).toBe("plain string");
	expect(truncateEvent(NON_EVENT_NUMBER)).toBe(NON_EVENT_NUMBER);
}

describe("truncateEvent", () => {
	it(
		"truncates an over-long output event's text with the marker",
		truncatesAnOverLongOutputEventsText
	);

	it(
		"truncates an over-long message event's text with the marker",
		truncatesAnOverLongMessageEventsText
	);

	it(
		"passes a modest CJK message through untouched (over the old cap, under the new one)",
		passesThroughAModestCjkMessageUntouched
	);

	it(
		"passes a larger CJK message through untouched",
		passesThroughALargerCjkMessageUntouched
	);

	it(
		"re-truncates (never degrades) a tool event with two huge string fields",
		reTruncatesAToolEventWithTwoHugeStringFields
	);

	it(
		"truncates a file event's over-long path when there's no diff",
		truncatesAFileEventsOverLongPathWithNoDiff
	);

	it(
		"leaves a short event untouched (same object identity)",
		leavesAShortEventUntouched
	);

	it(
		"passes through values that aren't normalized events",
		passesThroughNonNormalizedEventValues
	);
});

describe("truncateEvent — degrade & approvals", () => {
	it(
		"degrades a purely-structural oversized event with no truncatable text field",
		degradesAPurelyStructuralOversizedEvent
	);

	it(
		"keeps a huge approval (title + option labels) alive as an approval instead of degrading it",
		keepsAHugeApprovalAliveAsAnApproval
	);

	it(
		"caps a pathologically long approval options list instead of degrading the whole event",
		capsAPathologicallyLongApprovalOptionsList
	);
});

async function* arrayEvents<T>(values: T[]): AsyncGenerator<T> {
	await Promise.resolve();
	for (const value of values) {
		yield value;
	}
}

async function truncatesEveryEventInTheStream(): Promise<void> {
	const text = "d".repeat(MAX_EVENT_TEXT_BYTES + OVERFLOW_BYTES);
	const events: OutputEvent[] = [
		{ kind: "output", text: "short" },
		{ kind: "output", text },
	];

	const results: unknown[] = [];
	for await (const event of truncateEvents(arrayEvents(events))) {
		results.push(event);
	}

	expect(results[0]).toBe(events[0]);
	expect((results[1] as OutputEvent).text.length).toBeLessThan(text.length);
}

describe("truncateEvents", () => {
	it("truncates every event in the stream", truncatesEveryEventInTheStream);
});
