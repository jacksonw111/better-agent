import { expect, it } from "vitest";
import {
	capDiffLines,
	type DiffLine,
	diffCounts,
	diffFor,
	diffFromEditArgs,
	MAX_DIFF_LINES,
} from "./activity-diff";

it("builds a minimal 2-hunk diff from claude Edit args (old_string/new_string)", () => {
	const lines = diffFromEditArgs({
		old_string: "const a = 1;",
		new_string: "const a = 2;\nconst b = 3;",
	});
	expect(lines).toEqual([
		{ sign: "-", text: "const a = 1;" },
		{ sign: "+", text: "const a = 2;" },
		{ sign: "+", text: "const b = 3;" },
	]);
});

it("also accepts camelCase oldString/newString keys", () => {
	const lines = diffFromEditArgs({ oldString: "a", newString: "b" });
	expect(lines).toEqual([
		{ sign: "-", text: "a" },
		{ sign: "+", text: "b" },
	]);
});

it("omits the removal hunk when old_string is empty (pure insertion)", () => {
	const lines = diffFromEditArgs({ old_string: "", new_string: "new line" });
	expect(lines).toEqual([{ sign: "+", text: "new line" }]);
});

it("returns null when neither old_string nor new_string is present", () => {
	expect(diffFromEditArgs({ file_path: "a.ts" })).toBeNull();
	expect(diffFromEditArgs("not an object")).toBeNull();
});

it("counts added/removed lines", () => {
	const counts = diffCounts([
		{ sign: "-", text: "a" },
		{ sign: "+", text: "b" },
		{ sign: "+", text: "c" },
	]);
	expect(counts).toEqual({ added: 2, removed: 1 });
});

it("diffFor prefers a wire-supplied unified diff string over args parsing", () => {
	const lines = diffFor({
		args: { old_string: "ignored", new_string: "ignored" },
		result: "--- a\n+++ b\n@@ -1 +1 @@\n-old line\n+new line\n context",
	});
	expect(lines).toEqual([
		{ sign: "-", text: "old line" },
		{ sign: "+", text: "new line" },
	]);
});

it("diffFor falls back to args parsing when the result carries no diff", () => {
	const lines = diffFor({
		args: { old_string: "x", new_string: "y" },
		result: "plain tool output, not a diff",
	});
	expect(lines).toEqual([
		{ sign: "-", text: "x" },
		{ sign: "+", text: "y" },
	]);
});

it("diffFor returns null when neither source has a diff", () => {
	expect(diffFor({ args: { file_path: "a.ts" }, result: "ok" })).toBeNull();
});

// Reviewer finding 3 (minor): an inline diff has no size cap, so a huge Edit
// can blow up the DOM — cap total diff lines and mark the truncation.
it("capDiffLines leaves a diff at or under the cap untouched", () => {
	const lines: DiffLine[] = [{ sign: "+", text: "a" }];
	expect(capDiffLines(lines)).toBe(lines);
});

it("capDiffLines truncates a diff over the cap and appends a trailing marker line", () => {
	const lines: DiffLine[] = Array.from(
		{ length: MAX_DIFF_LINES + 50 },
		(_, i) => ({
			sign: "+" as const,
			text: `line ${i}`,
		})
	);
	const capped = capDiffLines(lines);
	expect(capped).toHaveLength(MAX_DIFF_LINES + 1);
	expect(capped.slice(0, MAX_DIFF_LINES)).toEqual(
		lines.slice(0, MAX_DIFF_LINES)
	);
	expect(capped.at(-1)).toEqual({ sign: "meta", text: "…(truncated)" });
});

it("diffFor applies the cap to a huge Edit-args diff", () => {
	const newText = Array.from(
		{ length: MAX_DIFF_LINES + 50 },
		(_, i) => `line ${i}`
	).join("\n");
	const result = diffFor({ args: { old_string: "", new_string: newText } });
	expect(result).toHaveLength(MAX_DIFF_LINES + 1);
	expect(result?.at(-1)).toEqual({ sign: "meta", text: "…(truncated)" });
});
