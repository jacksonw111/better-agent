import { describe, expect, it } from "vitest";
import type { BundleStandard } from "./bundle";
import {
	MANAGED_BEGIN,
	MANAGED_END,
	mergeManagedBlock,
	renderManagedBlock,
} from "./claude-md";

function standard(over: Partial<BundleStandard>): BundleStandard {
	return { body: "b", enabled: true, sortOrder: 0, title: "T", ...over };
}

describe("renderManagedBlock", () => {
	it("includes only enabled standards, ordered by sortOrder, title as heading", () => {
		const block = renderManagedBlock([
			standard({ title: "Second", body: "two", sortOrder: 2 }),
			standard({ title: "First", body: "one", sortOrder: 1 }),
			standard({ title: "Off", body: "x", enabled: false, sortOrder: 0 }),
		]);
		expect(block).toContain("## First");
		expect(block).toContain("one");
		expect(block.indexOf("First")).toBeLessThan(block.indexOf("Second"));
		expect(block).not.toContain("Off");
	});
});

describe("mergeManagedBlock", () => {
	it("appends a fresh managed block when the file has none", () => {
		const merged = mergeManagedBlock("# My notes\nkeep me\n", "BODY");
		expect(merged).toContain("# My notes");
		expect(merged).toContain("keep me");
		expect(merged).toContain(`${MANAGED_BEGIN}\nBODY\n${MANAGED_END}`);
	});

	it("creates the block from scratch when the file is null/empty", () => {
		const merged = mergeManagedBlock(null, "BODY");
		expect(merged).toBe(`${MANAGED_BEGIN}\nBODY\n${MANAGED_END}\n`);
	});

	it("replaces only the block interior, leaving user content outside intact", () => {
		const original = `above\n${MANAGED_BEGIN}\nOLD\n${MANAGED_END}\nbelow\n`;
		const merged = mergeManagedBlock(original, "NEW");
		expect(merged).toContain("above");
		expect(merged).toContain("below");
		expect(merged).toContain(`${MANAGED_BEGIN}\nNEW\n${MANAGED_END}`);
		expect(merged).not.toContain("OLD");
	});

	it("is idempotent: re-merging the same body yields the same file", () => {
		const once = mergeManagedBlock("user\n", "BODY");
		const twice = mergeManagedBlock(once, "BODY");
		expect(twice).toBe(once);
	});
});
