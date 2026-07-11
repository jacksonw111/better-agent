import { expect, it } from "vitest";
import {
	clampPct,
	deriveContextPct,
	formatContextUsage,
	formatCostCompact,
	formatCostUsd,
	formatDurationMs,
	formatStatusContextUsage,
	formatTokenCount,
	formatTokensCompact,
	truncateCwd,
} from "./bridge-usage-format";

it("formats cost to four decimal places", () => {
	expect(formatCostUsd(0.012_345)).toBe("$0.0123");
	expect(formatCostUsd(1)).toBe("$1.0000");
});

it("keeps sub-1000 token counts exact", () => {
	expect(formatTokenCount(847)).toBe("847");
	expect(formatTokenCount(0)).toBe("0");
});

it("compacts token counts of 1000 or more to one decimal 'k'", () => {
	expect(formatTokenCount(1234)).toBe("1.2k");
	expect(formatTokenCount(15_000)).toBe("15.0k");
});

it("formats a sub-minute duration as seconds with one decimal", () => {
	expect(formatDurationMs(4500)).toBe("4.5s");
	expect(formatDurationMs(950)).toBe("0.9s");
});

it("formats a duration past a minute as minutes and seconds", () => {
	expect(formatDurationMs(65_000)).toBe("1m 5s");
	expect(formatDurationMs(125_000)).toBe("2m 5s");
});

it("leaves a short cwd untouched", () => {
	expect(truncateCwd("/repo")).toBe("/repo");
});

it("truncates a long cwd from the front, keeping the tail", () => {
	const long = "/Users/john/some/very/deeply/nested/project/directory/name";
	const result = truncateCwd(long);
	expect(result.startsWith("…")).toBe(true);
	expect(long.endsWith(result.slice(1))).toBe(true);
});

it("compacts token counts to whole k (no decimal) for the usage line", () => {
	expect(formatTokensCompact(847)).toBe("847");
	expect(formatTokensCompact(48_213)).toBe("48k");
	expect(formatTokensCompact(200_000)).toBe("200k");
});

it("formats a compact cost with trailing zeros trimmed", () => {
	expect(formatCostCompact(0.045)).toBe("$0.045");
	expect(formatCostCompact(0.045_04)).toBe("$0.045");
	expect(formatCostCompact(1)).toBe("$1");
	expect(formatCostCompact(0.12)).toBe("$0.12");
});

it("formats opencode's streamed context usage as whole-k used/size tok · pct", () => {
	expect(formatContextUsage(48_213, 200_000)).toBe("48k/200k tok · 24%");
	expect(formatContextUsage(847, 1000)).toBe("847/1k tok · 85%");
	expect(formatContextUsage(0, 0)).toBe("0/0 tok · 0%");
});

it("formats a status_snapshot's context usage from a reported pct", () => {
	expect(
		formatStatusContextUsage({ used: 48_213, size: 200_000, pct: 24 })
	).toBe("48k/200k tok · 24%");
});

it("derives the percentage when a status_snapshot omits pct", () => {
	expect(formatStatusContextUsage({ used: 48_213, size: 200_000 })).toBe(
		"48k/200k tok · 24%"
	);
});

it("formats a status_snapshot's context usage from just a pct, with no token counts", () => {
	expect(formatStatusContextUsage({ pct: 24 })).toBe("24%");
});

it("returns null when a status_snapshot reports no context usage at all", () => {
	expect(formatStatusContextUsage({})).toBeNull();
});

it("compacts a million-plus token count to one decimal 'M'", () => {
	expect(formatTokensCompact(1_000_000)).toBe("1.0M");
	expect(formatTokensCompact(1_500_000)).toBe("1.5M");
});

it("derives the context pct from a usage_update's used/size when present", () => {
	expect(deriveContextPct({ used: 48_213, size: 200_000 }, null)).toBe(24);
});

it("prefers usage_update over a status_snapshot's context usage", () => {
	expect(
		deriveContextPct(
			{ used: 100_000, size: 200_000 },
			{ contextUsage: { pct: 10 } }
		)
	).toBe(50);
});

it("falls back to a status_snapshot's reported pct when no usage_update exists", () => {
	expect(deriveContextPct(null, { contextUsage: { pct: 24 } })).toBe(24);
});

it("derives the status_snapshot pct from used/size when pct is absent", () => {
	expect(
		deriveContextPct(null, {
			contextUsage: { used: 48_213, size: 200_000 },
		})
	).toBe(24);
});

it("returns null when neither source reports any context usage", () => {
	expect(deriveContextPct(null, null)).toBeNull();
	expect(deriveContextPct({}, { contextUsage: {} })).toBeNull();
});

it("clamps a percentage into [0, 100]", () => {
	expect(clampPct(-5)).toBe(0);
	expect(clampPct(50)).toBe(50);
	expect(clampPct(150)).toBe(100);
});
