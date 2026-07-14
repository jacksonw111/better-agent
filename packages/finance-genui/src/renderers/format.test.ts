import { expect, it } from "vitest";
import {
	changeColor,
	formatCompact,
	formatDate,
	formatNum,
	formatPct,
} from "./format";

const POSITIVE_CHANGE = 1.5;
const NEGATIVE_CHANGE = -0.3;

const TRILLION_SCALE = 1_499_222_864_079;
const HUNDRED_MILLION_SCALE = 149_922_286;
const TEN_THOUSAND_SCALE = 15_000;
const NEGATIVE_TEN_THOUSAND_SCALE = -15_000;
const SUB_WAN_VALUE = 1234.5;

const ONE_DECIMAL_PLACE = 1;
const UNROUNDED_VALUE = 1234.567;

const PCT_UNROUNDED_POSITIVE = 1.2345;
const PCT_NEGATIVE = -0.4;

it("changeColor is red for a positive change (红涨)", () => {
	expect(changeColor(POSITIVE_CHANGE)).toBe("#ef4444");
});

it("changeColor is green for a negative change (绿跌)", () => {
	expect(changeColor(NEGATIVE_CHANGE)).toBe("#16a34a");
});

it("changeColor is null (muted) for zero or missing", () => {
	expect(changeColor(0)).toBeNull();
	expect(changeColor(null)).toBeNull();
	expect(changeColor(undefined)).toBeNull();
});

it("formatCompact renders 万亿 for trillion-scale values", () => {
	expect(formatCompact(TRILLION_SCALE)).toBe("1.50万亿");
});

it("formatCompact renders 亿 for hundred-million-scale values", () => {
	expect(formatCompact(HUNDRED_MILLION_SCALE)).toBe("1.50亿");
});

it("formatCompact renders 万 for ten-thousand-scale values", () => {
	expect(formatCompact(TEN_THOUSAND_SCALE)).toBe("1.50万");
});

it("formatCompact falls back to formatNum below 万 and honors cny prefix", () => {
	expect(formatCompact(SUB_WAN_VALUE)).toBe("1,234.50");
	expect(formatCompact(SUB_WAN_VALUE, { cny: true })).toBe("¥1,234.50");
});

it("formatCompact preserves the sign", () => {
	expect(formatCompact(NEGATIVE_TEN_THOUSAND_SCALE)).toBe("-1.50万");
});

it("formatNum adds thousands separators and pads decimals", () => {
	expect(formatNum(SUB_WAN_VALUE)).toBe("1,234.50");
	expect(formatNum(UNROUNDED_VALUE, ONE_DECIMAL_PLACE)).toBe("1,234.6");
});

it("formatNum returns an em dash for null/NaN", () => {
	expect(formatNum(null)).toBe("—");
	expect(formatNum(Number.NaN)).toBe("—");
});

it("formatPct signs positive values and pads to 2dp", () => {
	expect(formatPct(PCT_UNROUNDED_POSITIVE)).toBe("+1.23%");
});

it("formatPct does not add a sign for negative or zero values", () => {
	expect(formatPct(PCT_NEGATIVE)).toBe("-0.40%");
	expect(formatPct(0)).toBe("0.00%");
});

it("formatDate renders date + time when the source has a time component", () => {
	expect(formatDate("2026-07-08T09:30:00.000Z")).toBe("2026-07-08 09:30");
});

it("formatDate renders date only when the source has no time component", () => {
	expect(formatDate("2026-07-08")).toBe("2026-07-08");
});

it("formatDate returns the source string when unparseable, and an em dash when empty", () => {
	expect(formatDate("not-a-date")).toBe("not-a-date");
	expect(formatDate("")).toBe("—");
	expect(formatDate(null)).toBe("—");
});
