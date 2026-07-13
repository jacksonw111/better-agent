import { expect, it } from "vitest";
import { formatDurationMs, formatElapsed } from "./activity-format";

it("formats a sub-second duration with one decimal", () => {
	expect(formatDurationMs(400)).toBe("0.4s");
});

it("formats a multi-second duration with one decimal", () => {
	expect(formatDurationMs(3100)).toBe("3.1s");
});

it("rounds to the nearest tenth of a second", () => {
	expect(formatDurationMs(3149)).toBe("3.1s");
	expect(formatDurationMs(3151)).toBe("3.2s");
});

it("formats a zero duration", () => {
	expect(formatDurationMs(0)).toBe("0.0s");
});

it("formats a sub-minute elapsed as whole seconds", () => {
	expect(formatElapsed(0)).toBe("0s");
	expect(formatElapsed(42_900)).toBe("42s");
});

it("formats a minutes-long elapsed as minutes plus padded seconds", () => {
	expect(formatElapsed(65_000)).toBe("1m 05s");
	expect(formatElapsed(185_000)).toBe("3m 05s");
	expect(formatElapsed(600_000)).toBe("10m 00s");
});
