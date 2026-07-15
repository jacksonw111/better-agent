import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-blocks";
import { toChatMessage } from "./chat-blocks";
import { streamPrompt } from "./use-chat";

function fakeStream(events: unknown[]) {
	return {
		// biome-ignore lint/suspicious/useAwait: test async generator
		async *stream() {
			for (const e of events) {
				yield e;
			}
		},
	} as unknown as import("@jacksonw111/agent-client").AgentClient;
}

function draftAssistant(): ChatMessage {
	return { id: "a", role: "assistant", status: "streaming", blocks: [] };
}
function draftUser(): ChatMessage {
	return {
		id: "u",
		role: "user",
		status: "complete",
		blocks: [{ kind: "text", text: "hi" }],
	};
}

async function run(events: unknown[]) {
	const drafts: ChatMessage[][] = [];
	const assistant = draftAssistant();
	await streamPrompt({
		agentClient: fakeStream(events),
		assistant,
		user: draftUser(),
		sessionId: "s",
		text: "hi",
		signal: new AbortController().signal,
		setDraft: (m) => drafts.push(m),
	});
	return drafts.at(-1)?.[1];
}

it("streams tool-call then tool-result into a tool block", async () => {
	const last = await run([
		{ type: "tool-call", callId: "c1", toolName: "search", args: { q: "x" } },
		{ type: "tool-result", callId: "c1", result: "ok", isError: false },
		{ type: "text-delta", delta: "answer" },
	]);
	const tool = last?.blocks.find((b) => b.kind === "tool");
	expect(tool).toMatchObject({
		kind: "tool",
		tool: { callId: "c1", status: "complete" },
	});
});

it("preserves the agent's output order across text and tool blocks", async () => {
	const last = await run([
		{ type: "text-delta", delta: "let me look" },
		{ type: "tool-call", callId: "c1", toolName: "search", args: {} },
		{ type: "tool-result", callId: "c1", result: "ok", isError: false },
		{ type: "text-delta", delta: "found it" },
	]);
	expect(last?.blocks.map((b) => b.kind)).toEqual(["text", "tool", "text"]);
	expect(last?.blocks[0]).toEqual({ kind: "text", text: "let me look" });
	expect(last?.blocks[2]).toEqual({ kind: "text", text: "found it" });
});

it("captures the error event message as errorText", async () => {
	const last = await run([{ type: "error", message: "rate limited" }]);
	expect(last?.status).toBe("error");
	expect(last?.errorText).toBe("rate limited");
});

it("marks the assistant complete when the stream ends cleanly", async () => {
	const last = await run([{ type: "text-delta", delta: "answer" }]);
	expect(last?.status).toBe("complete");
	expect(last?.live).toBe(false);
});

it("keeps error status when the stream ends after an error event", async () => {
	const last = await run([
		{ type: "text-delta", delta: "partial" },
		{ type: "error", message: "boom" },
	]);
	expect(last?.status).toBe("error");
});

function part(over: Record<string, unknown>) {
	return {
		id: "p",
		messageId: "m",
		seq: 0,
		status: "complete",
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	};
}

function rowWithToolPair() {
	return {
		message: { id: "m1", role: "assistant", status: "complete" },
		parts: [
			part({ type: "reasoning", content: { text: "think" } }),
			part({
				type: "tool-call",
				seq: 1,
				content: { callId: "c1", toolName: "search", args: { q: "x" } },
			}),
			part({
				type: "tool-result",
				seq: 2,
				content: { callId: "c1", result: { hits: 3 }, isError: false },
			}),
			part({ type: "text", seq: 3, content: { text: "done" } }),
		],
	} as unknown as Parameters<typeof toChatMessage>[0];
}

describe("toChatMessage", () => {
	it("builds ordered blocks (reasoning, tool, text) from parts", () => {
		const msg = toChatMessage(rowWithToolPair());
		expect(msg.blocks).toHaveLength(3);
		expect(msg.blocks[0]).toEqual({ kind: "reasoning", text: "think" });
		expect(msg.blocks[1]).toMatchObject({
			kind: "tool",
			tool: { callId: "c1", status: "complete", result: { hits: 3 } },
		});
		expect(msg.blocks[2]).toEqual({ kind: "text", text: "done" });
	});

	it("marks a tool-call without a result as running", () => {
		const row = {
			message: { id: "m2", role: "assistant", status: "streaming" },
			parts: [
				part({
					type: "tool-call",
					content: { callId: "c9", toolName: "fetch", args: {} },
				}),
			],
		} as unknown as Parameters<typeof toChatMessage>[0];
		expect(toChatMessage(row).blocks[0]).toMatchObject({
			kind: "tool",
			tool: { callId: "c9", status: "running" },
		});
	});

	it("marks an errored tool-result as status error", () => {
		const row = {
			message: { id: "m3", role: "assistant", status: "complete" },
			parts: [
				part({
					type: "tool-call",
					content: { callId: "c2", toolName: "x", args: {} },
				}),
				part({
					type: "tool-result",
					seq: 1,
					content: { callId: "c2", result: "boom", isError: true },
				}),
			],
		} as unknown as Parameters<typeof toChatMessage>[0];
		expect(toChatMessage(row).blocks[0]).toMatchObject({
			kind: "tool",
			tool: { status: "error", isError: true },
		});
	});
});
