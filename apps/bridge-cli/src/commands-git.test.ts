import { expect, it, vi } from "vitest";
import { dispatchControlCommand } from "./command-dispatch";
import type { CommandSink } from "./commands";
import { parseCommandText } from "./commands";

// P4-T4: gitStatus/gitDiff/gitCommit control commands — wire parse (requestId
// always mandatory, gitCommit's message mandatory) and dispatch to the
// optional CommandSink methods. Mirrors commands-fs.test.ts.

function sink() {
	const gitCommit = vi.fn<(requestId: string, message: string) => void>();
	const gitDiff = vi.fn<(requestId: string, path?: string) => void>();
	const gitStatus = vi.fn<(requestId: string) => void>();
	const target: CommandSink = {
		answerApproval: vi.fn(),
		gitCommit,
		gitDiff,
		gitStatus,
		send: vi.fn(),
	};
	return { gitCommit, gitDiff, gitStatus, target };
}

it("parses gitStatus, rejecting it without a requestId", () => {
	expect(
		parseCommandText({ type: "control", action: "gitStatus", requestId: "r1" })
	).toEqual({ action: "gitStatus", requestId: "r1", type: "control" });
	expect(parseCommandText({ type: "control", action: "gitStatus" })).toBeNull();
});

it("parses gitDiff with and without a path", () => {
	expect(
		parseCommandText({ type: "control", action: "gitDiff", requestId: "r2" })
	).toEqual({
		action: "gitDiff",
		path: undefined,
		requestId: "r2",
		type: "control",
	});
	expect(
		parseCommandText({
			type: "control",
			action: "gitDiff",
			path: "src/a.ts",
			requestId: "r3",
		})
	).toEqual({
		action: "gitDiff",
		path: "src/a.ts",
		requestId: "r3",
		type: "control",
	});
});

it("parses gitCommit only when both requestId and message are strings", () => {
	expect(
		parseCommandText({
			type: "control",
			action: "gitCommit",
			message: "fix: x",
			requestId: "r4",
		})
	).toEqual({
		action: "gitCommit",
		message: "fix: x",
		requestId: "r4",
		type: "control",
	});
	expect(
		parseCommandText({ type: "control", action: "gitCommit", requestId: "r5" })
	).toBeNull();
	expect(
		parseCommandText({ type: "control", action: "gitCommit", message: "m" })
	).toBeNull();
});

it("dispatches the three git actions to the sink with requestId first", () => {
	const { gitCommit, gitDiff, gitStatus, target } = sink();
	dispatchControlCommand(
		{ action: "gitStatus", requestId: "r6", type: "control" },
		target
	);
	dispatchControlCommand(
		{ action: "gitDiff", path: "a.ts", requestId: "r7", type: "control" },
		target
	);
	dispatchControlCommand(
		{ action: "gitCommit", message: "msg", requestId: "r8", type: "control" },
		target
	);
	expect(gitStatus).toHaveBeenCalledWith("r6");
	expect(gitDiff).toHaveBeenCalledWith("r7", "a.ts");
	expect(gitCommit).toHaveBeenCalledWith("r8", "msg");
});

it("is a silent no-op on a sink without git methods", () => {
	const bare: CommandSink = { answerApproval: vi.fn(), send: vi.fn() };
	expect(() =>
		dispatchControlCommand(
			{ action: "gitStatus", requestId: "r9", type: "control" },
			bare
		)
	).not.toThrow();
});
