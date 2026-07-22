import { describe, expect, it } from "vitest";
import { MAX_EVENT_TEXT_BYTES, truncateStringToBytes } from "./truncate-fields";

const EMOJI = "\u{1F600}"; // 😀 — a 4-byte astral code point (2 UTF-16 units)
const EMOJI_BUDGET_BYTES = 6; // room for exactly one 4-byte emoji
const EMOJI_INPUT_COUNT = 3;
const EMOJI_UNITS_PER = 2;
const REPLACEMENT_CHAR = "�";

/** The byte budget lands mid-way through the SECOND emoji; a naive byte cut
 * would split its 4-byte encoding and produce mojibake. The code-point-aware
 * cut must keep exactly the first (whole) emoji and drop the rest. */
function neverSplitsAMultiByteCodePoint(): void {
	const value = EMOJI.repeat(EMOJI_INPUT_COUNT);

	const result = truncateStringToBytes(value, EMOJI_BUDGET_BYTES);

	const head = result.slice(0, result.indexOf("…"));
	expect(head).toBe(EMOJI);
	expect(result).not.toContain(REPLACEMENT_CHAR);
	expect(Array.from(head).every((codePoint) => codePoint === EMOJI)).toBe(true);
	const droppedUnits = (EMOJI_INPUT_COUNT - 1) * EMOJI_UNITS_PER;
	expect(result).toBe(`${EMOJI}… [+${droppedUnits} chars truncated]`);
}

function returnsShortStringsUntouched(): void {
	expect(truncateStringToBytes("hi", MAX_EVENT_TEXT_BYTES)).toBe("hi");
}

describe("truncateStringToBytes", () => {
	it(
		"never splits a multi-byte code point at the budget",
		neverSplitsAMultiByteCodePoint
	);
	it(
		"returns a string already within budget untouched",
		returnsShortStringsUntouched
	);
});
