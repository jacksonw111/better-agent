// R3-T1: the text command's optional busy-turn `when` — split into its own
// file rather than growing commands.test.ts (already at the repo's 300-line
// convention cap), mirroring command-dispatch.test.ts's own precedent.

import { describe, expect, it } from "vitest";
import { parseCommandText } from "./commands";
import { parseTextCommand } from "./commands-text-when";

describe("parseTextCommand", () => {
	it("omits `when` for an absent value", () => {
		expect(parseTextCommand("go", undefined)).toEqual({
			text: "go",
			type: "text",
		});
	});

	it("carries a recognized `when` through", () => {
		expect(parseTextCommand("go", "steer")).toEqual({
			text: "go",
			type: "text",
			when: "steer",
		});
		expect(parseTextCommand("go", "interrupt")).toEqual({
			text: "go",
			type: "text",
			when: "interrupt",
		});
		expect(parseTextCommand("go", "queue")).toEqual({
			text: "go",
			type: "text",
			when: "queue",
		});
	});

	it("degrades an unrecognized `when` to the default (omitted), not a rejected parse", () => {
		expect(parseTextCommand("go", "bogus")).toEqual({
			text: "go",
			type: "text",
		});
		expect(parseTextCommand("go", true)).toEqual({ text: "go", type: "text" });
	});
});

describe("parseTextCommand — images (P3-T2)", () => {
	const ref = { id: "att-1", mime: "image/png", name: "shot.png" };

	it("carries well-formed image refs through", () => {
		expect(parseTextCommand("go", undefined, [ref])).toEqual({
			text: "go",
			type: "text",
			images: [ref],
		});
	});

	it("filters malformed entries, keeping the valid ones", () => {
		expect(
			parseTextCommand("go", "steer", [ref, { id: 1 }, "nope", null])
		).toEqual({ text: "go", type: "text", when: "steer", images: [ref] });
	});

	it("omits `images` for an absent/empty/non-array value (plain text command)", () => {
		expect(parseTextCommand("go", undefined)).toEqual({
			text: "go",
			type: "text",
		});
		expect(parseTextCommand("go", undefined, [])).toEqual({
			text: "go",
			type: "text",
		});
		expect(parseTextCommand("go", undefined, "bogus")).toEqual({
			text: "go",
			type: "text",
		});
		expect(parseTextCommand("go", undefined, [{ id: "x" }])).toEqual({
			text: "go",
			type: "text",
		});
	});
});

describe("parseCommandText — text command `when` (R3-T1)", () => {
	it("a bare string still parses with no `when` (back-compat)", () => {
		expect(parseCommandText("go")).toEqual({ type: "text", text: "go" });
	});

	it("a `{ text }` object still parses with no `when` (back-compat)", () => {
		expect(parseCommandText({ text: "go" })).toEqual({
			type: "text",
			text: "go",
		});
	});

	it("a `{ type: 'text', text, when: 'steer' }` object carries `when` through", () => {
		expect(
			parseCommandText({ type: "text", text: "go", when: "steer" })
		).toEqual({ type: "text", text: "go", when: "steer" });
	});

	it("a `{ text, when: 'interrupt' }` object (no explicit type) also carries `when` through", () => {
		expect(parseCommandText({ text: "go", when: "interrupt" })).toEqual({
			type: "text",
			text: "go",
			when: "interrupt",
		});
	});

	it("a `{ text, images }` object carries the image refs through (P3-T2)", () => {
		const ref = { id: "att-1", mime: "image/png", name: "shot.png" };
		expect(parseCommandText({ text: "look", images: [ref] })).toEqual({
			type: "text",
			text: "look",
			images: [ref],
		});
	});
});
