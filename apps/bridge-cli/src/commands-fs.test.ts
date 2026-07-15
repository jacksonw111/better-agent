import { expect, it, vi } from "vitest";
import { dispatchControlCommand } from "./command-dispatch";
import type { CommandSink } from "./commands";
import { parseCommandText } from "./commands";

// P4-T3: fsList/fsRead control commands — wire parse (requestId mandatory,
// fsRead's path mandatory) and dispatch to the optional CommandSink methods.

function sink() {
	const fsList = vi.fn<(requestId: string, path?: string) => void>();
	const fsRead = vi.fn<(requestId: string, path: string) => void>();
	const target: CommandSink = {
		answerApproval: vi.fn(),
		fsList,
		fsRead,
		send: vi.fn(),
	};
	return { fsList, fsRead, target };
}

it("parses fsList with and without a path", () => {
	expect(
		parseCommandText({ type: "control", action: "fsList", requestId: "r1" })
	).toEqual({
		action: "fsList",
		path: undefined,
		requestId: "r1",
		type: "control",
	});
	expect(
		parseCommandText({
			type: "control",
			action: "fsList",
			path: "src",
			requestId: "r2",
		})
	).toEqual({
		action: "fsList",
		path: "src",
		requestId: "r2",
		type: "control",
	});
});

it("parses fsRead only when both requestId and path are strings", () => {
	expect(
		parseCommandText({
			type: "control",
			action: "fsRead",
			path: "src/a.ts",
			requestId: "r3",
		})
	).toEqual({
		action: "fsRead",
		path: "src/a.ts",
		requestId: "r3",
		type: "control",
	});
	expect(
		parseCommandText({ type: "control", action: "fsRead", requestId: "r4" })
	).toBeNull();
	expect(
		parseCommandText({ type: "control", action: "fsRead", path: "a.ts" })
	).toBeNull();
});

it("rejects fsList without a requestId", () => {
	expect(
		parseCommandText({ type: "control", action: "fsList", path: "src" })
	).toBeNull();
});

it("dispatches fsList/fsRead to the sink with requestId first", () => {
	const { fsList, fsRead, target } = sink();
	dispatchControlCommand(
		{ action: "fsList", path: "src", requestId: "r5", type: "control" },
		target
	);
	dispatchControlCommand(
		{ action: "fsRead", path: "src/a.ts", requestId: "r6", type: "control" },
		target
	);
	expect(fsList).toHaveBeenCalledWith("r5", "src");
	expect(fsRead).toHaveBeenCalledWith("r6", "src/a.ts");
});

it("is a silent no-op on a sink without fs methods", () => {
	const bare: CommandSink = { answerApproval: vi.fn(), send: vi.fn() };
	expect(() =>
		dispatchControlCommand(
			{ action: "fsRead", path: "a.ts", requestId: "r7", type: "control" },
			bare
		)
	).not.toThrow();
});
