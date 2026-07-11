import { expect, it } from "vitest";
import { formatDurationMs } from "./activity-format";

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
