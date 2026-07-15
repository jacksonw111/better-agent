// P4-T5 specs for the search channel's request/response correlation
// (session-search-correlation.ts): the single `session_search` reply resolves
// the matching requestId, errors reject it, silence times out, and dispose
// rejects everything still pending — same contract as fs/git-correlation.

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	createSessionSearchCorrelator,
	SESSION_SEARCH_TIMEOUT_MESSAGE,
	SESSION_SEARCH_TIMEOUT_MS,
} from "./session-search-correlation";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

function statusEvent(detail: Record<string, unknown>): StreamEvent {
	return {
		event: { detail, kind: "status", status: "session_search" },
		id: 1,
	} as unknown as StreamEvent;
}

function makeCorrelator(send = vi.fn().mockResolvedValue(undefined)) {
	let counter = 0;
	const correlator = createSessionSearchCorrelator({
		mintId: () => `req-${++counter}`,
		send: { search: send },
	});
	return { correlator, send };
}

it("resolves the pending search with the reply's hits and partial flag", async () => {
	const { correlator, send } = makeCorrelator();
	const promise = correlator.search("needle");
	expect(send).toHaveBeenCalledWith("req-1", "needle");

	correlator.ingest([
		statusEvent({
			partial: true,
			requestId: "req-1",
			results: [
				{
					id: "s-1",
					snippets: [{ role: "user", text: "a needle" }],
					title: "t",
				},
			],
		}),
	]);

	await expect(promise).resolves.toEqual({
		hits: [
			{
				cwd: undefined,
				id: "s-1",
				lastModified: undefined,
				snippets: [{ role: "user", text: "a needle" }],
				title: "t",
			},
		],
		partial: true,
	});
});

it("rejects on an error reply and ignores non-matching requestIds", async () => {
	const { correlator } = makeCorrelator();
	const promise = correlator.search("needle");

	correlator.ingest([statusEvent({ requestId: "req-other", results: [] })]);
	correlator.ingest([
		statusEvent({ error: "store exploded", requestId: "req-1" }),
	]);

	await expect(promise).rejects.toThrow("store exploded");
});

it("times out after SESSION_SEARCH_TIMEOUT_MS of silence", async () => {
	const { correlator } = makeCorrelator();
	const promise = correlator.search("needle");
	const assertion = expect(promise).rejects.toThrow(
		SESSION_SEARCH_TIMEOUT_MESSAGE
	);

	await vi.advanceTimersByTimeAsync(SESSION_SEARCH_TIMEOUT_MS + 1);

	await assertion;
});

it("a failed control send settles the request instead of hanging it", async () => {
	const { correlator } = makeCorrelator(
		vi.fn().mockRejectedValue(new Error("offline"))
	);
	const promise = correlator.search("needle");
	const assertion = expect(promise).rejects.toThrow(
		SESSION_SEARCH_TIMEOUT_MESSAGE
	);

	await vi.advanceTimersByTimeAsync(0);

	await assertion;
});

it("dispose rejects everything still pending", async () => {
	const { correlator } = makeCorrelator();
	const promise = correlator.search("needle");
	const assertion = expect(promise).rejects.toThrow(
		"The session's search channel closed."
	);

	correlator.dispose();

	await assertion;
});
