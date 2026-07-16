import { expect, it } from "vitest";
import {
	insertSkillReference,
	parseSlashTokenAtCursor,
} from "./description-slash-picker";

// Pure-logic coverage for the wizard Description's cursor-aware "/" token:
// unlike the chat composer (leading-slash-only), a Skill Reference can be
// typed anywhere in the Description and inserted repeatedly (spec §8.3), so
// parsing
// and insertion are both relative to the cursor.

it("parses a bare '/' at the start of the description", () => {
	expect(parseSlashTokenAtCursor("/", 1)).toEqual({ query: "", start: 0 });
});

it("parses a slash token typed mid-description after whitespace", () => {
	const text = "use /res later";
	expect(parseSlashTokenAtCursor(text, "use /res".length)).toEqual({
		query: "res",
		start: "use ".length,
	});
});

it("does not open for a slash inside a word (paths stay plain text)", () => {
	expect(parseSlashTokenAtCursor("a/b", "a/b".length)).toBeNull();
});

it("closes once a space completes the token", () => {
	const text = "/research ";
	expect(parseSlashTokenAtCursor(text, text.length)).toBeNull();
});

it("ignores slash tokens after the cursor", () => {
	expect(parseSlashTokenAtCursor("hello /res", "hello".length)).toBeNull();
});

it("replaces the in-progress token with the reference at the cursor", () => {
	const text = "use /res later";
	const cursor = "use /res".length;
	const token = parseSlashTokenAtCursor(text, cursor);
	expect(token).not.toBeNull();
	if (!token) {
		return;
	}
	expect(insertSkillReference(text, token, cursor, "research")).toEqual({
		cursor: "use /research ".length,
		text: "use /research  later",
	});
});

it("supports inserting a second reference later in the text", () => {
	const text = "/research then /to";
	const cursor = text.length;
	const token = parseSlashTokenAtCursor(text, cursor);
	expect(token).not.toBeNull();
	if (!token) {
		return;
	}
	expect(insertSkillReference(text, token, cursor, "to-spec")).toEqual({
		cursor: "/research then /to-spec ".length,
		text: "/research then /to-spec ",
	});
});
