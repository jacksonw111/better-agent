// P4-T5 specs for the `searchSessions` control command: wire parsing
// (commands-control.ts) and CommandSink routing (command-dispatch.ts) — same
// shape as commands-git.test.ts's coverage of the P4-T4 commands.

import { expect, it, vi } from "vitest";
import { dispatchCommands } from "./commands";
import { parseControlCommand } from "./commands-control";

it("parses a well-formed searchSessions control command", () => {
	expect(
		parseControlCommand({
			action: "searchSessions",
			query: "login bug",
			requestId: "req-1",
			type: "control",
		})
	).toEqual({
		action: "searchSessions",
		query: "login bug",
		requestId: "req-1",
		type: "control",
	});
});

it("rejects searchSessions commands missing requestId or query", () => {
	expect(
		parseControlCommand({ action: "searchSessions", query: "x" })
	).toBeNull();
	expect(
		parseControlCommand({ action: "searchSessions", requestId: "req-1" })
	).toBeNull();
	expect(
		parseControlCommand({
			action: "searchSessions",
			query: 5,
			requestId: "req-1",
		})
	).toBeNull();
});

it("routes searchSessions to the sink and no-ops when unimplemented", () => {
	const searchSessions = vi.fn();
	const sink = {
		answerApproval: vi.fn(),
		searchSessions,
		send: vi.fn(),
	};
	const command = {
		data: {
			action: "searchSessions",
			query: "needle",
			requestId: "req-9",
			type: "control",
		},
		id: 1,
	};

	dispatchCommands([command], sink, { current: 0 });
	expect(searchSessions).toHaveBeenCalledWith("req-9", "needle");

	// A sink without the method (old adapter) must not crash the dispatch.
	const bare = { answerApproval: vi.fn(), send: vi.fn() };
	expect(() => dispatchCommands([command], bare, { current: 0 })).not.toThrow();
});
