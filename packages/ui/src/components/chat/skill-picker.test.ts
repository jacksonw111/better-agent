import { expect, it } from "vitest";
import {
	applySkillPickerSelection,
	clampSkillPickerIndex,
	filterSkillPickerItems,
	parseSkillQuery,
} from "./skill-picker";

it("recognizes a bare slash or a slash-prefixed query typed at the start", () => {
	expect(parseSkillQuery("/")).toBe("");
	expect(parseSkillQuery("/pd")).toBe("pd");
});

it("stops recognizing a query once a space follows the slash", () => {
	expect(parseSkillQuery("/pdf ")).toBeNull();
	expect(parseSkillQuery("/pdf bar")).toBeNull();
});

it("does not treat a slash typed mid-message as a query", () => {
	expect(parseSkillQuery("fix this /pdf")).toBeNull();
	expect(parseSkillQuery("a/b")).toBeNull();
	expect(parseSkillQuery("hello")).toBeNull();
	expect(parseSkillQuery("")).toBeNull();
});

it("filters skills by case-insensitive name prefix, dropping non-matches", () => {
	const skills = [
		{ name: "pdf", description: "Turn a page into a searchable PDF" },
		{ name: "compare-docs", description: "Diff two documents" },
		{ name: "clear", description: "Clear the conversation" },
	];
	expect(filterSkillPickerItems(skills, "co")).toEqual([
		{ name: "compare-docs", description: "Diff two documents" },
	]);
	expect(filterSkillPickerItems(skills, "PD")).toEqual([
		{ name: "pdf", description: "Turn a page into a searchable PDF" },
	]);
});

it("matches everything for an empty query (a bare '/')", () => {
	const skills = [{ name: "pdf", description: "Turn a page into a PDF" }];
	expect(filterSkillPickerItems(skills, "")).toEqual(skills);
});

it("fills the composer with the skill invocation, trailing space for args", () => {
	expect(applySkillPickerSelection({ name: "pdf", description: "..." })).toBe(
		"/pdf "
	);
});

it("clamps and wraps the active index around the item count", () => {
	const itemCount = 3;
	const lastIndex = itemCount - 1;
	expect(clampSkillPickerIndex(0, itemCount)).toBe(0);
	expect(clampSkillPickerIndex(lastIndex, itemCount)).toBe(lastIndex);
	expect(clampSkillPickerIndex(itemCount, itemCount)).toBe(0);
	expect(clampSkillPickerIndex(-1, itemCount)).toBe(lastIndex);
	expect(clampSkillPickerIndex(0, 0)).toBe(0);
	expect(clampSkillPickerIndex(-1, 0)).toBe(0);
});
