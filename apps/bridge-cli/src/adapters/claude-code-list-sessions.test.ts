// listSessions() specs — split out of claude-code.test.ts purely to keep
// that file under the repo's 300-line limit, the same way
// claude-code-config.test.ts already splits off other claude-code.ts specs.

import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import {
	mockQuery,
	nextEvent,
	skipStartupReady,
} from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("listSessions() pushes a session_list status event with the fetched sessions", async () => {
	mockQuery();
	vi.mocked(listSessions).mockResolvedValue([
		{
			sessionId: "sess-1",
			summary: "Fix the login bug",
			lastModified: 1_700_000_000_000,
			gitBranch: "main",
			cwd: "/tmp/project",
		},
		{
			sessionId: "sess-2",
			summary: "first prompt fallback",
			customTitle: "My renamed session",
			lastModified: 1_700_000_001_000,
		},
	]);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await skipStartupReady(iterator);

	handle.listSessions?.();

	expect(await nextEvent(iterator)).toEqual({
		kind: "status",
		status: "session_list",
		detail: {
			sessions: [
				{
					id: "sess-1",
					title: "Fix the login bug",
					lastModified: 1_700_000_000_000,
					gitBranch: "main",
					cwd: "/tmp/project",
				},
				{
					id: "sess-2",
					title: "My renamed session",
					lastModified: 1_700_000_001_000,
					gitBranch: undefined,
					cwd: undefined,
				},
			],
		},
		turnEpoch: 0,
	});
	expect(vi.mocked(listSessions)).toHaveBeenLastCalledWith({
		dir: "/tmp/project",
	});
});

it("listSessions() pushes an error event when the SDK call rejects", async () => {
	mockQuery();
	vi.mocked(listSessions).mockRejectedValue(new Error("no claude dir"));
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();
	await skipStartupReady(iterator);

	handle.listSessions?.();

	expect(await nextEvent(iterator)).toEqual({
		kind: "error",
		message: "Failed to list past claude sessions",
		detail: "no claude dir",
		turnEpoch: 0,
	});
});
