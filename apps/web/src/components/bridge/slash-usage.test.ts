// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import {
	MAX_SLASH_USAGE_ENTRIES,
	pruneSlashUsage,
	readSlashUsage,
	recordSlashUsage,
} from "./slash-usage";

const STORAGE_KEY = "ba:slash-usage";

beforeEach(() => {
	localStorage.clear();
});

it("reads an empty map when nothing is stored", () => {
	expect(readSlashUsage()).toEqual({});
});

it("increments a name's count across records and persists it", () => {
	recordSlashUsage("compact");
	recordSlashUsage("compact");
	recordSlashUsage("pdf");

	expect(readSlashUsage()).toEqual({ compact: 2, pdf: 1 });
});

it("degrades corrupt or mis-shaped storage to an empty map", () => {
	localStorage.setItem(STORAGE_KEY, "not json");
	expect(readSlashUsage()).toEqual({});

	localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2]));
	expect(readSlashUsage()).toEqual({});

	localStorage.setItem(STORAGE_KEY, JSON.stringify({ compact: "two" }));
	expect(readSlashUsage()).toEqual({});
});

it("recovers from corrupt storage on the next record", () => {
	localStorage.setItem(STORAGE_KEY, "not json");
	recordSlashUsage("compact");

	expect(readSlashUsage()).toEqual({ compact: 1 });
});

it("prunes the lowest counts once past the entry cap", () => {
	const counts: Record<string, number> = {};
	for (let i = 0; i < MAX_SLASH_USAGE_ENTRIES + 1; i++) {
		counts[`cmd-${i}`] = i + 1;
	}

	const pruned = pruneSlashUsage(counts);

	expect(Object.keys(pruned)).toHaveLength(MAX_SLASH_USAGE_ENTRIES);
	// cmd-0 held the lowest count (1) — the one entry pruned away.
	expect(pruned["cmd-0"]).toBeUndefined();
	expect(pruned["cmd-1"]).toBe(2);
	expect(pruned[`cmd-${MAX_SLASH_USAGE_ENTRIES}`]).toBe(
		MAX_SLASH_USAGE_ENTRIES + 1
	);
});

it("keeps a map at or under the cap untouched", () => {
	const counts = { compact: 1, pdf: 2 };
	expect(pruneSlashUsage(counts)).toBe(counts);
});

it("applies the prune when a record pushes storage past the cap", () => {
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify(
			Object.fromEntries(
				Array.from({ length: MAX_SLASH_USAGE_ENTRIES }, (_, index) => [
					`cmd-${index}`,
					index + 2,
				])
			)
		)
	);

	recordSlashUsage("newcomer");

	const stored = readSlashUsage();
	expect(Object.keys(stored)).toHaveLength(MAX_SLASH_USAGE_ENTRIES);
	// The newcomer's single use is the lowest count — it's the pruned entry.
	expect(stored.newcomer).toBeUndefined();
});
