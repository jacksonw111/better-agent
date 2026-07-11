// R5-T1: claude-code's one-time command_catalog fetch — split out of
// claude-code.test.ts purely to keep that file under the repo's 300-line
// limit (mirrors claude-code-list-sessions.test.ts).

import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import {
	type ClaudeQuery,
	fetchSupportedCommands,
} from "./claude-code-commands";
import { mockQuery, nextEvent } from "./claude-code-test-harness";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("emits a command_catalog status event off the agent's supportedCommands() once", async () => {
	mockQuery(
		[],
		[
			{
				name: "clear",
				description: "Clear the conversation",
				argumentHint: "",
			},
			{
				name: "compact",
				description: "Compact the conversation",
				argumentHint: "",
			},
		]
	);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	expect(await nextEvent(iterator)).toEqual({
		kind: "status",
		status: "command_catalog",
		detail: {
			commands: [
				{ name: "clear", description: "Clear the conversation" },
				{ name: "compact", description: "Compact the conversation" },
			],
		},
		turnEpoch: 0,
	});
});

it("emits no command_catalog event when the agent reports no commands", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	harness.yieldMessage({
		type: "system",
		subtype: "init",
		session_id: "sess-1",
		model: "claude-opus-4",
	});

	const event = await nextEvent(iterator);
	expect(event).toMatchObject({ kind: "status", status: "session_ready" });
});

it("fetchSupportedCommands resolves undefined (not a rejection) when the control channel errors", async () => {
	const fakeSession = {
		supportedCommands: vi.fn(() =>
			Promise.reject(new Error("control channel down"))
		),
	} as unknown as ClaudeQuery;

	await expect(fetchSupportedCommands(fakeSession)).resolves.toBeUndefined();
});

it("replaces the cached catalog with a mid-session commands_changed push", async () => {
	const { harness } = mockQuery(
		[],
		[{ name: "clear", description: "old", argumentHint: "" }]
	);
	const handle = await claudeCodeAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	expect(await nextEvent(iterator)).toMatchObject({
		status: "command_catalog",
		detail: { commands: [{ name: "clear", description: "old" }] },
	});

	harness.yieldMessage({
		type: "system",
		subtype: "commands_changed",
		commands: [{ name: "new-cmd", description: "discovered mid-session" }],
	});

	expect(await nextEvent(iterator)).toEqual({
		kind: "status",
		status: "command_catalog",
		detail: {
			commands: [{ name: "new-cmd", description: "discovered mid-session" }],
		},
		turnEpoch: 0,
	});
});
