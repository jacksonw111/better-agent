// @vitest-environment jsdom
import { useChat } from "@better-agent/ui/components/chat/use-chat";
import type { AgentClient, MessageHistory } from "@jacksonw111/agent-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { expect, it } from "vitest";

// Regression: on a FRESH session, completing a turn must never render an empty
// message list (the "chat goes blank, then messages pop back" bug).

const STAMP = new Date("2026-07-02T00:00:00Z");

function historyRow(
	id: string,
	role: "user" | "assistant",
	seq: number
): MessageHistory[number] {
	return {
		message: {
			id,
			sessionId: "s1",
			role,
			seq,
			status: "complete",
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: STAMP,
			updatedAt: STAMP,
		},
		parts: [],
	} as unknown as MessageHistory[number];
}

// Server-side view: empty until the turn finishes, then both rows exist.
function fakeAgentClient(state: { done: boolean }): AgentClient {
	return {
		listMessages: () =>
			Promise.resolve(
				state.done
					? [historyRow("u1", "user", 1), historyRow("a1", "assistant", 2)]
					: []
			),
		// biome-ignore lint/suspicious/useAwait: test async generator
		async *stream() {
			yield { type: "text-delta", delta: "hello " };
			yield { type: "text-delta", delta: "world" };
			state.done = true;
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

it("never renders zero messages between send start and completion", async () => {
	const state = { done: false };
	const client = fakeAgentClient(state);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const renderLog: Array<{ count: number; streaming: boolean }> = [];
	let api: ReturnType<typeof useChat> | null = null;

	function Probe() {
		const chat = useChat("s1", client);
		api = chat;
		renderLog.push({ count: chat.messages.length, streaming: chat.streaming });
		return null;
	}
	function Wrapper({ children }: { children: ReactNode }) {
		return createElement(
			QueryClientProvider,
			{ client: queryClient },
			children
		);
	}

	render(createElement(Wrapper, null, createElement(Probe)));

	// Let the initial (empty) history fetch settle.
	await act(async () => {
		await queryClient.ensureQueryData({
			queryKey: ["agent", "messages", "s1"],
			queryFn: () => client.listMessages("s1"),
		});
	});

	const sendStartIndex = renderLog.length;
	await act(async () => {
		await api?.send("hi");
	});
	// Flush any trailing microtasks/refetches.
	await act(async () => {
		await Promise.resolve();
	});

	const afterSend = renderLog.slice(sendStartIndex);
	// Once the draft is on screen, the list must never blank out (count 0)…
	const firstVisible = afterSend.findIndex((entry) => entry.count > 0);
	const afterVisible = afterSend.slice(firstVisible);
	expect(afterVisible.filter((entry) => entry.count === 0)).toEqual([]);
	// …and must never double-render the turn (draft + persisted rows = 4).
	const maxCount = Math.max(...afterVisible.map((entry) => entry.count));
	expect(maxCount).toBeLessThanOrEqual(2);
	// And the completed turn is visible at the end.
	expect(renderLog.at(-1)?.count).toBe(2);
	expect(renderLog.at(-1)?.streaming).toBe(false);
});
