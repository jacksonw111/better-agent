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
		expect(parseTextCommand("go", 42)).toEqual({ text: "go", type: "text" });
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
});
