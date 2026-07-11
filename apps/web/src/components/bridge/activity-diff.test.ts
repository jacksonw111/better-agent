import { expect, it } from "vitest";
import { diffCounts, diffFor, diffFromEditArgs } from "./activity-diff";

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
