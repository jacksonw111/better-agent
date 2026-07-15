import { expect, it } from "vitest";
import {
	applyFileMention,
	filterMentionEntries,
	parseFileMention,
} from "./file-mention";
import type { FsEntry } from "./fs-events";

// P4-T3: the composer @file picker's pure text half — trailing-@ query
// parsing, dir/prefix splitting, and selection insertion.

it("parses a trailing @ token at start, after whitespace, split on /", () => {
	expect(parseFileMention("@")).toEqual({ dirPath: "", prefix: "", start: 0 });
	expect(parseFileMention("look at @src/comp")).toEqual({
		dirPath: "src",
		prefix: "comp",
		start: 8,
	});
	expect(parseFileMention("@src/a/b")).toEqual({
		dirPath: "src/a",
		prefix: "b",
		start: 0,
	});
});

it("does not parse mid-word @, closed mentions, or @-free text", () => {
	expect(parseFileMention("mail@example.com")).toBeNull();
	expect(parseFileMention("see @src/a.ts done")).toBeNull();
	expect(parseFileMention("no mention here")).toBeNull();
});

it("applies a file selection as `@path ` and a dir as `@path/`", () => {
	const file: FsEntry = { name: "a.ts", type: "file" };
	const dir: FsEntry = { name: "components", type: "dir" };
	const queryRoot = { dirPath: "", prefix: "a", start: 5 };
	expect(applyFileMention("look @a", queryRoot, file)).toBe("look @a.ts ");
	const queryNested = { dirPath: "src", prefix: "comp", start: 0 };
	expect(applyFileMention("@src/comp", queryNested, dir)).toBe(
		"@src/components/"
	);
});

it("prefix-filters entries case-insensitively with a cap", () => {
	const entries: FsEntry[] = [
		{ name: "README.md", type: "file" },
		{ name: "readme-old.md", type: "file" },
		{ name: "src", type: "dir" },
	];
	expect(filterMentionEntries(entries, "read", 10).length).toBe(2);
	expect(filterMentionEntries(entries, "", 2).length).toBe(2);
	expect(filterMentionEntries(entries, "zzz", 10)).toEqual([]);
});
