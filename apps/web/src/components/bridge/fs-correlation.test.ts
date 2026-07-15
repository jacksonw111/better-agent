import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	createFsCorrelator,
	FS_REQUEST_TIMEOUT_MS,
	FS_TIMEOUT_MESSAGE,
} from "./fs-correlation";

// P4-T3: requestId correlation — list/read resolve off matching fs_list/
// fs_read status events, chunks reassemble out of order, and the inactivity
// timeout rejects (but re-arms while chunks are still flowing).

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

function setup() {
	const sent: { action: string; path?: string; requestId: string }[] = [];
	let minted = 0;
	const correlator = createFsCorrelator({
		mintId: () => {
			minted += 1;
			return `id-${minted}`;
		},
		send: {
			list: (requestId, path) => {
				sent.push({ action: "list", path, requestId });
				return Promise.resolve();
			},
			read: (requestId, path) => {
				sent.push({ action: "read", path, requestId });
				return Promise.resolve();
			},
		},
	});
	return { correlator, sent };
}

const ESCAPES_RE = /escapes/;

const statusEvent = (
	id: number,
	status: string,
	detail: unknown
): StreamEvent => ({ event: { detail, kind: "status", status }, id });

it("resolves a list from the reply matching its requestId only", async () => {
	const { correlator, sent } = setup();
	const promise = correlator.list("src");
	expect(sent).toEqual([{ action: "list", path: "src", requestId: "id-1" }]);
	correlator.ingest([
		statusEvent(1, "fs_list", {
			entries: [{ name: "other", type: "file" }],
			requestId: "someone-else",
		}),
		statusEvent(2, "fs_list", {
			entries: [{ name: "a.ts", size: 3, type: "file" }],
			requestId: "id-1",
			truncated: true,
		}),
	]);
	await expect(promise).resolves.toEqual({
		entries: [{ name: "a.ts", size: 3, type: "file" }],
		truncated: true,
	});
});

it("rejects a list whose reply carries an error", async () => {
	const { correlator } = setup();
	const promise = correlator.list("../nope");
	correlator.ingest([
		statusEvent(1, "fs_list", {
			error: "path escapes the workspace",
			requestId: "id-1",
		}),
	]);
	await expect(promise).rejects.toThrow(ESCAPES_RE);
});

it("reassembles read chunks arriving out of order", async () => {
	const { correlator } = setup();
	const promise = correlator.read("big.txt");
	const chunk = (chunkIndex: number, content: string, done: boolean) =>
		statusEvent(chunkIndex + 1, "fs_read", {
			chunkIndex,
			content,
			done,
			requestId: "id-1",
			size: 6,
			totalChunks: 3,
			truncated: false,
		});
	correlator.ingest([chunk(2, "cc", true), chunk(0, "aa", false)]);
	correlator.ingest([chunk(1, "bb", false)]);
	await expect(promise).resolves.toEqual({
		binary: false,
		content: "aabbcc",
		size: 6,
		truncated: false,
	});
});

it("resolves a binary reply with no content", async () => {
	const { correlator } = setup();
	const promise = correlator.read("logo.png");
	correlator.ingest([
		statusEvent(1, "fs_read", {
			binary: true,
			done: true,
			requestId: "id-1",
			size: 512,
		}),
	]);
	await expect(promise).resolves.toEqual({
		binary: true,
		content: "",
		size: 512,
		truncated: false,
	});
});

it("rejects after the timeout when no reply ever arrives", async () => {
	const { correlator } = setup();
	const promise = correlator.list();
	const rejection = expect(promise).rejects.toThrow(FS_TIMEOUT_MESSAGE);
	vi.advanceTimersByTime(FS_REQUEST_TIMEOUT_MS + 1);
	await rejection;
});

it("re-arms the read timeout on every chunk, then rejects once idle", async () => {
	const { correlator } = setup();
	const promise = correlator.read("slow.txt");
	const rejection = expect(promise).rejects.toThrow(FS_TIMEOUT_MESSAGE);
	vi.advanceTimersByTime(FS_REQUEST_TIMEOUT_MS - 1);
	correlator.ingest([
		statusEvent(1, "fs_read", {
			chunkIndex: 0,
			content: "aa",
			done: false,
			requestId: "id-1",
			totalChunks: 2,
		}),
	]);
	// The chunk re-armed the timer — the ORIGINAL deadline passing is fine…
	vi.advanceTimersByTime(FS_REQUEST_TIMEOUT_MS - 1);
	// …but a full quiet window after the last chunk is not.
	vi.advanceTimersByTime(2);
	await rejection;
});
