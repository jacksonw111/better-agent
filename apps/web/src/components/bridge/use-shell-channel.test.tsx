// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { getShellChannel } from "./shell-channel-store";
import { usePublishShellChannel } from "./use-shell-channel";

// The published shell events must be accumulated INCREMENTALLY — only the new
// tail of the feed is scanned per render, like use-fs-channel.ts — because
// re-filtering the whole (unbounded) feed array on every streamed token is
// one of the O(n)-per-render costs that ground the /tasks chat tab to a halt.

function shellEvt(id: number, callId: string): StreamEvent {
	return {
		id,
		event: {
			id: callId,
			kind: "tool",
			name: "runShell",
			source: "runShell",
			status: "started",
		},
	};
}

function chatEvt(id: number): StreamEvent {
	return { id, event: { kind: "message", role: "assistant", text: "hi" } };
}

function renderChannel(initialEvents: StreamEvent[]) {
	const run = () => Promise.resolve();
	return renderHook(
		({ events }: { events: StreamEvent[] }) =>
			usePublishShellChannel(events, true, run),
		{ initialProps: { events: initialEvents } }
	);
}

it("publishes only the feed's shell events, in feed order", () => {
	renderChannel([chatEvt(1), shellEvt(2, "c1"), chatEvt(3), shellEvt(4, "c2")]);
	expect(getShellChannel()?.events.map((entry) => entry.id)).toEqual([2, 4]);
});

it("only scans the new tail on growth — already-processed entries are never revisited", () => {
	const first = [shellEvt(1, "c1"), chatEvt(2)];
	const { rerender } = renderChannel(first);
	expect(getShellChannel()?.events[0]).toBe(first[0]);

	// Grow the feed, but hand back a DIFFERENT object at index 0: a tail-only
	// scan keeps publishing the entry it already processed, proving the head
	// was not re-filtered.
	const grown = [shellEvt(1, "c1-replaced"), chatEvt(2), shellEvt(3, "c2")];
	rerender({ events: grown });

	const published = getShellChannel()?.events;
	expect(published?.map((entry) => entry.id)).toEqual([1, 3]);
	expect(published?.[0]).toBe(first[0]);
});

it("keeps the published events reference stable when the new tail has no shell events", () => {
	const first = [shellEvt(1, "c1")];
	const { rerender } = renderChannel(first);
	const before = getShellChannel()?.events;

	rerender({ events: [...first, chatEvt(2), chatEvt(3)] });
	expect(getShellChannel()?.events).toBe(before);
});

it("rebuilds from scratch when the feed shrinks (session switch resets it)", () => {
	const { rerender } = renderChannel([
		shellEvt(1, "c1"),
		chatEvt(2),
		shellEvt(3, "c2"),
	]);
	rerender({ events: [shellEvt(9, "c9")] });
	expect(getShellChannel()?.events.map((entry) => entry.id)).toEqual([9]);
});
