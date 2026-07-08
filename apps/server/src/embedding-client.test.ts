import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildEmbeddingClient } from "./embedding-client";

// Unit tests for the SiliconFlow embedding client's retry policy. `fetch` is
// mocked and timers are faked, so exponential-backoff sleeps resolve instantly
// and no real network call is made. The env key is set so `embed` reaches the
// HTTP path rather than short-circuiting on a missing key.

const EMBEDDING_DIMENSIONS = 1024;
const RETRYABLE_STATUS = 503;
const PERMANENT_STATUS = 400;
const TOO_MANY_REQUESTS = 429;
// Hoisted per the no-in-scope-regex rule; each matches its status in the
// thrown "SiliconFlow embedding failed (NNN): …" message.
const PERMANENT_STATUS_PATTERN = /400/;
const RETRYABLE_STATUS_PATTERN = /503/;

function okResponse(): Response {
	const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
	return new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
		status: 200,
	});
}

function errorResponse(status: number, headers?: HeadersInit): Response {
	return new Response("upstream boom", { status, headers });
}

// Drives the backoff sleeps to completion so retries run without real
// wall-clock delay. Attaches a handler to `promise` synchronously (via
// Promise.all) so a rejection during timer draining is never momentarily
// unhandled; timers are guarded for the same reason.
function settle<T>(promise: Promise<T>): Promise<T> {
	const timers = vi.runAllTimersAsync().catch(() => undefined);
	return Promise.all([promise, timers]).then(([value]) => value);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv("SILICONFLOW_API_KEY", "test-key");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("returns the vector on a first-try success", async () => {
	const fetchMock = vi.fn().mockResolvedValue(okResponse());
	vi.stubGlobal("fetch", fetchMock);

	const vector = await settle(buildEmbeddingClient().embed("hello"));

	expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("retries a transient 5xx and then succeeds", async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(errorResponse(RETRYABLE_STATUS))
		.mockResolvedValueOnce(errorResponse(RETRYABLE_STATUS))
		.mockResolvedValueOnce(okResponse());
	vi.stubGlobal("fetch", fetchMock);

	const vector = await settle(buildEmbeddingClient().embed("hello"));

	expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
	expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("retries a network error and then succeeds", async () => {
	const fetchMock = vi
		.fn()
		.mockRejectedValueOnce(new Error("ECONNRESET"))
		.mockResolvedValueOnce(okResponse());
	vi.stubGlobal("fetch", fetchMock);

	const vector = await settle(buildEmbeddingClient().embed("hello"));

	expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
	expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does NOT retry a permanent 4xx", async () => {
	const fetchMock = vi.fn().mockResolvedValue(errorResponse(PERMANENT_STATUS));
	vi.stubGlobal("fetch", fetchMock);

	await expect(settle(buildEmbeddingClient().embed("hello"))).rejects.toThrow(
		PERMANENT_STATUS_PATTERN
	);
	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("gives up after the attempt cap and throws the last error", async () => {
	const fetchMock = vi.fn().mockResolvedValue(errorResponse(RETRYABLE_STATUS));
	vi.stubGlobal("fetch", fetchMock);

	await expect(settle(buildEmbeddingClient().embed("hello"))).rejects.toThrow(
		RETRYABLE_STATUS_PATTERN
	);
	// 1 initial + 3 retries.
	expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("honors a Retry-After header on 429 without exceeding the cap", async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(
			errorResponse(TOO_MANY_REQUESTS, { "retry-after": "1" })
		)
		.mockResolvedValueOnce(okResponse());
	vi.stubGlobal("fetch", fetchMock);

	const vector = await settle(buildEmbeddingClient().embed("hello"));

	expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
	expect(fetchMock).toHaveBeenCalledTimes(2);
});
