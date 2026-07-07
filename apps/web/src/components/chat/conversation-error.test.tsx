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

// A turn whose tool ERRORS: text streams, a tool-call fires, its result comes
// back isError, then the model wraps up. The reply (text + errored tool) must
// never vanish on completion.
function toolErrorClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	return {
		listMessages: () => {
			if (state.phase === "idle") {
				return Promise.resolve([]);
			}
			const status = state.phase === "done" ? "complete" : "streaming";
			return Promise.resolve([
				row("u1", "user", "complete", 1, "hi-question"),
				row("a1", "assistant", status, 2, "OK-marker checking now"),
			]);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker checking now" };
			await tick(300);
			yield {
				type: "tool-call",
				callId: "c1",
				toolName: "x_user_tweets",
				args: { screen_name: "jack" },
			};
			await tick(TICK_MS * 3);
			yield {
				type: "tool-result",
				callId: "c1",
				result: "X request failed: something broke",
				isError: true,
			};
			await tick(TICK_MS * 3);
			state.phase = "done";
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

// A turn where the STREAM itself throws mid-reply (e.g. a fatal tool error
// propagates), but the server persisted the turn. The already-streamed text
// must not vanish.
function streamThrowsClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	return {
		listMessages: () => {
			if (state.phase === "idle") {
				return Promise.resolve([]);
			}
			const status = state.phase === "done" ? "complete" : "streaming";
			return Promise.resolve([
				row("u1", "user", "complete", 1, "hi-question"),
				row("a1", "assistant", status, 2, "OK-marker partial reply"),
			]);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker partial reply" };
			await tick(300);
			// Server finishes the turn even though the client stream died.
			state.phase = "done";
			throw new Error("stream error");
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

// A turn that completes but whose persisted assistant row lands with EMPTY
// parts first (status flips to complete a beat before the parts flush). The
// draft must stay until the row actually has content — no empty-swap flash.
function emptyThenFilledClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	let doneReads = 0;
	const EMPTY_READS = 2;
	const emptyRow = () =>
		({
			...row("a1", "assistant", "complete", 2, ""),
			parts: [],
		}) as unknown as ReturnType<typeof row>;
	return {
		listMessages: () => {
			if (state.phase !== "done") {
				return Promise.resolve([
					row("u1", "user", "complete", 1, "hi-question"),
					{
						...row("a1", "assistant", "streaming", 2, ""),
						parts: [],
					} as unknown as ReturnType<typeof row>,
				]);
			}
			doneReads += 1;
			if (doneReads <= EMPTY_READS) {
				return Promise.resolve([
					row("u1", "user", "complete", 1, "hi-question"),
					emptyRow(),
				]);
			}
			return Promise.resolve([
				row("u1", "user", "complete", 1, "hi-question"),
				row("a1", "assistant", "complete", 2, "OK-marker final reply"),
			]);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker final reply" };
			await tick(300);
			state.phase = "done";
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

it("empty-then-filled history row never flashes an empty reply", {
	timeout: 10_000,
}, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(emptyThenFilledClient(state), "s-empty");
	const dom = watchDom(container);
	await waitFor(() => expect(state.phase).toBe("done"), { timeout: 6000 });
	await act(async () => {
		await tick(2000);
	});
	dom.stop();
	assertNeverVanishes(dom.snapshots, "OK-marker");
	expect(container.textContent).toContain("OK-marker final reply");
});

it("tool-error turn never vanishes", { timeout: 10_000 }, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(toolErrorClient(state), "s-toolerr");
	const dom = watchDom(container);
	await waitFor(() => expect(state.phase).toBe("done"), { timeout: 6000 });
	await act(async () => {
		await tick(600);
	});
	dom.stop();
	assertNeverVanishes(dom.snapshots, "OK-marker");
	expect(container.textContent).toContain("OK-marker");
});

it("stream-throw turn keeps the already-streamed reply", {
	timeout: 10_000,
}, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(streamThrowsClient(state), "s-throw");
	const dom = watchDom(container);
	await waitFor(() => expect(state.phase).toBe("done"), { timeout: 6000 });
	await act(async () => {
		await tick(600);
	});
	dom.stop();
	assertNeverVanishes(dom.snapshots, "OK-marker");
	expect(container.textContent).toContain("OK-marker");
});
