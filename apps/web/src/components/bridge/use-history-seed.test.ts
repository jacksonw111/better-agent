// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { BridgeTransport } from "./bridge-transport";
import {
	HISTORY_PAGE_LIMIT,
	useHistorySeed,
} from "./use-bridge-connection-effects";
import type { FeedAction } from "./use-bridge-feed";

// B4 loss fix: the history seed must pull the WHOLE persisted backlog via
// afterSeq cursor pagination, not just the oldest page — otherwise a session
// longer than one page permanently loses everything between the first page's
// tail and the live relay window's start.

const SESSION_ID = "session-1";

function statusRows(from: number, count: number) {
	return Array.from({ length: count }, (_, i) => ({
		seq: from + i,
		event: { kind: "status", status: "restarted" },
	}));
}

function makeTransport(pages: { event: unknown; seq: number }[][]) {
	const history = vi.fn();
	for (const page of pages) {
		history.mockResolvedValueOnce(page);
	}
	history.mockResolvedValue([]);
	const transport = {
		connectStream: vi.fn(),
		history,
		observe: vi.fn().mockResolvedValue([]),
		sendInput: vi.fn().mockResolvedValue(undefined),
	} as unknown as BridgeTransport;
	return { history, transport };
}

function dispatchedIds(dispatchFeed: ReturnType<typeof vi.fn>): number[] {
	return dispatchFeed.mock.calls
		.map(([action]) => action as FeedAction)
		.filter(
			(action): action is Extract<FeedAction, { type: "events" }> =>
				action.type === "events"
		)
		.flatMap((action) => action.events.map((row) => row.id));
}

it("seeds a short backlog with a single page", async () => {
	const { history, transport } = makeTransport([statusRows(1, 2)]);
	const dispatchFeed = vi.fn();
	const { result } = renderHook(() =>
		useHistorySeed({ dispatchFeed, sessionId: SESSION_ID, transport })
	);

	await waitFor(() => {
		expect(result.current).toBe(true);
	});
	expect(history).toHaveBeenCalledTimes(1);
	expect(history).toHaveBeenCalledWith({
		sessionId: SESSION_ID,
		afterSeq: 0,
		limit: HISTORY_PAGE_LIMIT,
	});
	expect(dispatchedIds(dispatchFeed)).toEqual([1, 2]);
});

it("paginates by afterSeq cursor until a short page, covering the full backlog", async () => {
	const tailCount = 2;
	const { history, transport } = makeTransport([
		statusRows(1, HISTORY_PAGE_LIMIT),
		statusRows(HISTORY_PAGE_LIMIT + 1, tailCount),
	]);
	const dispatchFeed = vi.fn();
	const { result } = renderHook(() =>
		useHistorySeed({ dispatchFeed, sessionId: SESSION_ID, transport })
	);

	await waitFor(() => {
		expect(result.current).toBe(true);
	});
	expect(history).toHaveBeenCalledTimes(2);
	expect(history).toHaveBeenNthCalledWith(2, {
		sessionId: SESSION_ID,
		afterSeq: HISTORY_PAGE_LIMIT,
		limit: HISTORY_PAGE_LIMIT,
	});
	// Every seq from 1 through the tail landed, in order, with no hole between
	// the first page's end and the second page's start.
	const ids = dispatchedIds(dispatchFeed);
	expect(ids).toHaveLength(HISTORY_PAGE_LIMIT + tailCount);
	expect(ids[0]).toBe(1);
	expect(ids.at(-1)).toBe(HISTORY_PAGE_LIMIT + tailCount);
	expect(ids.every((id, i) => id === i + 1)).toBe(true);
});

it("stops paginating when a full page fails to advance the cursor", async () => {
	// Defensive: a buggy/misbehaving server returning the same full page
	// forever must not spin the seed loop.
	const samePage = statusRows(1, HISTORY_PAGE_LIMIT).map((row) => ({
		...row,
		seq: 0,
	}));
	const { history, transport } = makeTransport([samePage]);
	const dispatchFeed = vi.fn();
	const { result } = renderHook(() =>
		useHistorySeed({ dispatchFeed, sessionId: SESSION_ID, transport })
	);

	await waitFor(() => {
		expect(result.current).toBe(true);
	});
	expect(history).toHaveBeenCalledTimes(1);
});

it("still flips loaded when the history fetch fails", async () => {
	const history = vi.fn().mockRejectedValue(new Error("network down"));
	const transport = {
		connectStream: vi.fn(),
		history,
		observe: vi.fn(),
		sendInput: vi.fn(),
	} as unknown as BridgeTransport;
	const dispatchFeed = vi.fn();
	const { result } = renderHook(() =>
		useHistorySeed({ dispatchFeed, sessionId: SESSION_ID, transport })
	);

	await waitFor(() => {
		expect(result.current).toBe(true);
	});
	expect(dispatchFeed).not.toHaveBeenCalled();
});
