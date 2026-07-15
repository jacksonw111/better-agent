import { expect, it } from "vitest";
import { MAX_STATUS_ENTRIES, parseStatusPorcelain } from "./git-porcelain";

// P4-T4: the pure porcelain-v1 parser — branch header variants, entry status
// chars (staged/unstaged/untracked), renames, quoted paths, and the entry cap.

it("parses the branch header with ahead/behind counts", () => {
	const summary = parseStatusPorcelain(
		"## main...origin/main [ahead 2, behind 3]\n M a.txt\n"
	);
	expect(summary.branch).toBe("main");
	expect(summary.ahead).toBe(2);
	expect(summary.behind).toBe(3);
});

it("parses plain, behind-only, detached and no-commits-yet headers", () => {
	expect(parseStatusPorcelain("## dev\n").branch).toBe("dev");
	const behind = parseStatusPorcelain("## dev...origin/dev [behind 4]\n");
	expect(behind.ahead).toBeUndefined();
	expect(behind.behind).toBe(4);
	expect(parseStatusPorcelain("## HEAD (no branch)\n").branch).toBe(
		"HEAD (no branch)"
	);
	expect(parseStatusPorcelain("## No commits yet on main\n").branch).toBe(
		"main"
	);
});

it("parses staged, unstaged, both-sided and untracked entries", () => {
	const summary = parseStatusPorcelain(
		"## main\nM  staged.ts\n M unstaged.ts\nMM both.ts\n?? new.ts\n"
	);
	expect(summary.entries).toEqual([
		{ path: "staged.ts", x: "M", y: " " },
		{ path: "unstaged.ts", x: " ", y: "M" },
		{ path: "both.ts", x: "M", y: "M" },
		{ path: "new.ts", x: "?", y: "?" },
	]);
});

it("parses a rename entry keeping its source as origPath", () => {
	const summary = parseStatusPorcelain("## main\nR  old.ts -> new.ts\n");
	expect(summary.entries).toEqual([
		{ origPath: "old.ts", path: "new.ts", x: "R", y: " " },
	]);
});

it("unquotes porcelain-quoted paths with escapes", () => {
	const summary = parseStatusPorcelain(
		'## main\n?? "with \\"quote\\".txt"\n?? "tab\\there.txt"\n'
	);
	expect(summary.entries[0]?.path).toBe('with "quote".txt');
	expect(summary.entries[1]?.path).toBe("tab\there.txt");
});

it("caps entries at MAX_STATUS_ENTRIES and marks truncated", () => {
	const lines = Array.from(
		{ length: MAX_STATUS_ENTRIES + 1 },
		(_, index) => `?? file-${index}.txt`
	);
	const summary = parseStatusPorcelain(`## main\n${lines.join("\n")}\n`);
	expect(summary.entries).toHaveLength(MAX_STATUS_ENTRIES);
	expect(summary.truncated).toBe(true);
	expect(parseStatusPorcelain("## main\n?? a.txt\n").truncated).toBe(false);
});
