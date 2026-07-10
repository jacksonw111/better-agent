import { expect, it } from "vitest";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES, truncateOutput } from "./truncate";

it("passes small output through unchanged", () => {
	const r = truncateOutput("hello");
	expect(r).toEqual({ output: "hello", truncated: false });
});

it("truncates output longer than the line limit and appends a notice", () => {
	const text = Array.from(
		{ length: MAX_OUTPUT_LINES + 50 },
		(_, i) => `line ${i}`
	).join("\n");
	const r = truncateOutput(text);
	expect(r.truncated).toBe(true);
	expect(r.output.split("\n").length).toBeLessThanOrEqual(MAX_OUTPUT_LINES + 1);
	expect(r.output).toContain("truncated");
});

it("truncates output larger than the byte limit", () => {
	const size = MAX_OUTPUT_BYTES + 1000;
	const r = truncateOutput("x".repeat(size));
	expect(r.truncated).toBe(true);
	expect(r.output.length).toBeLessThan(size);
	expect(r.output).toContain("truncated");
});
