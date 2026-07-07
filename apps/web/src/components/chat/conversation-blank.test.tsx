// @vitest-environment jsdom
import type { AgentClient } from "@jacksonw111/agent-client";
import { act, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import {
	assertNeverVanishes,
	renderChat,
	row,
	TICK_MS,
	tick,
	watchDom,
} from "./conversation-test-harness";

// Server-realistic history: rows exist (streaming) DURING the turn.
function fakeClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	return {
		listMessages: () => {
			if (state.phase === "idle") {
				return Promise.resolve([]);
			}
			const assistantStatus = state.phase === "done" ? "complete" : "streaming";
			return Promise.resolve([
				row("u1", "user", "complete", 1, "hi-question"),
				row(
					"a1",
					"assistant",
					assistantStatus,
					2,
					"let me check — here is the answer"
				),
			]);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "let me check" };
			await tick(TICK_MS);
			yield {
				type: "tool-call",
				callId: "c1",
				toolName: "TWITTER_SEARCH",
				args: { q: "x" },
			};
			// Tool executing on the server — the suspicious window.
			await tick(TICK_MS * 4);
			yield {
				type: "tool-result",
				callId: "c1",
				result: "found things",
				isError: false,
			};
			await tick(TICK_MS);
			yield { type: "text-delta", delta: " — here is the answer" };
			await tick(TICK_MS * 3);
			state.phase = "done";
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
		uploadAttachment: () => Promise.reject(new Error("not in test")),
		getAttachment: () => Promise.reject(new Error("not in test")),
	} as unknown as AgentClient;
}

// The SSE dies mid-reply. In the on-page model the live draft is the single
// source of truth, so the partially-streamed reply is COMMITTED and stays on
// screen (the full server version loads only on refresh). It must never vanish.
function dyingClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	return {
		listMessages: () => Promise.resolve([]),
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker partial reply" };
			await tick(400);
			state.phase = "done";
			throw new Error("SSE connection lost");
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

// A chat opened WITH prior server history (loaded once as the seed), then a new
// turn is sent. Both the seeded history and the new committed turn must show —
// the new turn renders its CLIENT draft content (the on-page source of truth),
// not a re-fetched server copy.
function seededClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	const prior = [
		row("u0", "user", "complete", 1, "old-question"),
		row("a0", "assistant", "complete", 2, "old-answer"),
	];
	return {
		listMessages: () => Promise.resolve(prior),
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker new reply" };
			await tick(400);
			state.phase = "done";
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

it("the sent turn coexists with seeded history and never vanishes", {
	timeout: 10_000,
}, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(seededClient(state), "s-seed");
	const dom = watchDom(container);
	await waitFor(() => expect(state.phase).toBe("done"), { timeout: 6000 });
	await act(async () => {
		await tick(600);
	});
	dom.stop();
	assertNeverVanishes(dom.snapshots, "hi-question");
	assertNeverVanishes(dom.snapshots, "OK-marker");
	// Seeded history and the committed turn both remain.
	expect(container.textContent).toContain("old-answer");
	expect(container.textContent).toContain("OK-marker new reply");
});

it("a stream that dies mid-reply commits the partial and never vanishes", {
	timeout: 10_000,
}, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(dyingClient(state), "s-dying");
	const dom = watchDom(container);
	await waitFor(() => expect(state.phase).toBe("done"), { timeout: 6000 });
	await act(async () => {
		await tick(600);
	});
	dom.stop();
	assertNeverVanishes(dom.snapshots, "hi-question");
	assertNeverVanishes(dom.snapshots, "OK-marker");
	// The partial reply stays committed on screen.
	expect(container.textContent).toContain("OK-marker partial reply");
});

it("chat content never vanishes between first paint and completion", async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(fakeClient(state), "s1");
	const dom = watchDom(container);

	// initialText auto-sends after mount; wait for the turn to fully finish.
	await waitFor(
		() => {
			expect(state.phase).toBe("done");
		},
		{ timeout: 5000 }
	);
	// Let finalize (fetch + draft clear) and any trailing renders settle.
	await act(async () => {
		await tick(TICK_MS * 4);
	});
	dom.stop();

	assertNeverVanishes(dom.snapshots, "hi-question");
	// The empty-state copy must never appear once content exists.
	const first = dom.snapshots.findIndex((s) => s.includes("hi-question"));
	expect(
		dom.snapshots
			.slice(first)
			.filter((s) => s.includes("Start the conversation"))
	).toEqual([]);
});
