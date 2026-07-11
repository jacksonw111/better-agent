import { describe, expect, it } from "vitest";
import {
	createCodexFileChangeCache,
	recordCodexFileChangeStart,
} from "./codex-file-change-cache";

describe("createCodexFileChangeCache - summary formatting", () => {
	it("summarizes added/modified/deleted counts and lists the changed paths", () => {
		const cache = createCodexFileChangeCache();
		cache.record({
			id: "item_1",
			changes: [
				{ path: "a.ts", kind: "created" },
				{ path: "b.ts", kind: "modified" },
				{ path: "c.ts", kind: "deleted" },
			],
		});
		expect(cache.summaryFor("item_1")).toBe(
			"3 files: 1 added, 1 modified, 1 deleted (a.ts, b.ts, c.ts)"
		);
	});

	it("treats an unrecognized change kind as modified, mirroring codex.ts's own fileChange mapping", () => {
		const cache = createCodexFileChangeCache();
		cache.record({
			id: "item_1",
			changes: [{ path: "a.ts", kind: "renamed" }],
		});
		expect(cache.summaryFor("item_1")).toBe("1 file: 1 modified (a.ts)");
	});

	it("truncates the path list past the first few and marks the rest with an ellipsis", () => {
		const cache = createCodexFileChangeCache();
		cache.record({
			id: "item_1",
			changes: [
				{ path: "a.ts", kind: "modified" },
				{ path: "b.ts", kind: "modified" },
				{ path: "c.ts", kind: "modified" },
				{ path: "d.ts", kind: "modified" },
			],
		});
		expect(cache.summaryFor("item_1")).toBe(
			"4 files: 4 modified (a.ts, b.ts, c.ts, …)"
		);
	});
});

describe("createCodexFileChangeCache - malformed input & lookup misses", () => {
	it("is a no-op for an item with no string id", () => {
		const cache = createCodexFileChangeCache();
		cache.record({ changes: [{ path: "a.ts", kind: "modified" }] });
		expect(cache.summaryFor("item_1")).toBeUndefined();
	});

	it("is a no-op for an item whose changes isn't an array", () => {
		const cache = createCodexFileChangeCache();
		cache.record({ id: "item_1", changes: "nope" });
		expect(cache.summaryFor("item_1")).toBeUndefined();
	});

	it("skips a malformed change entry (no string path) instead of throwing", () => {
		const cache = createCodexFileChangeCache();
		cache.record({
			id: "item_1",
			changes: [{ kind: "modified" }, { path: "b.ts", kind: "modified" }],
		});
		expect(cache.summaryFor("item_1")).toBe("1 file: 1 modified (b.ts)");
	});

	it("returns undefined for an itemId that was never recorded", () => {
		const cache = createCodexFileChangeCache();
		expect(cache.summaryFor("does-not-exist")).toBeUndefined();
	});
});

describe("recordCodexFileChangeStart", () => {
	it("records a fileChange item off an item/started notification", () => {
		const cache = createCodexFileChangeCache();
		recordCodexFileChangeStart(cache, {
			method: "item/started",
			params: {
				item: {
					id: "item_1",
					type: "fileChange",
					changes: [{ path: "a.ts", kind: "created" }],
				},
			},
		});
		expect(cache.summaryFor("item_1")).toBe("1 file: 1 added (a.ts)");
	});

	it("ignores an item/started notification for a non-fileChange item", () => {
		const cache = createCodexFileChangeCache();
		recordCodexFileChangeStart(cache, {
			method: "item/started",
			params: { item: { id: "item_1", type: "commandExecution" } },
		});
		expect(cache.summaryFor("item_1")).toBeUndefined();
	});

	it("ignores any notification other than item/started", () => {
		const cache = createCodexFileChangeCache();
		recordCodexFileChangeStart(cache, {
			method: "item/completed",
			params: {
				item: {
					id: "item_1",
					type: "fileChange",
					changes: [{ path: "a.ts", kind: "created" }],
				},
			},
		});
		expect(cache.summaryFor("item_1")).toBeUndefined();
	});

	it("does not throw on a malformed raw line", () => {
		const cache = createCodexFileChangeCache();
		expect(() => recordCodexFileChangeStart(cache, null)).not.toThrow();
		expect(() =>
			recordCodexFileChangeStart(cache, { method: "item/started" })
		).not.toThrow();
	});
});
