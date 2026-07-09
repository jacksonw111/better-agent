// Focused spec for opencode-serve-http.ts's request timeout: a hung `opencode
// serve` (TCP connection open, no response) must never leave `getJson`/
// `postJson` (and therefore `getStatus`/`send`/`setModel`/`interrupt`/an
// approval reply, all built on top of them — see opencode-serve.ts) waiting on
// a `fetch` that never settles.
//
// `createServeHttp`'s timeout is exercised via its (test-only) override
// parameter rather than fake timers: `AbortSignal.timeout` schedules on
// Node's internal timer machinery, not the global `setTimeout` vitest's fake
// timers patch, so `vi.advanceTimersByTimeAsync` can't fast-forward it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createServeHttp } from "./opencode-serve-http";

const TEST_TIMEOUT_MS = 20;

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A `fetch` stand-in for a hung server: the returned promise never resolves
 * on its own, but rejects like real `fetch` does once the request's abort
 * signal fires. */
function createHangingFetch(): typeof fetch {
	return vi.fn(
		(_input: string | URL, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("The operation was aborted.", "AbortError"));
				});
			})
	) as unknown as typeof fetch;
}

/** Races `promise` against a short real-time delay to prove it did NOT
 * settle within that window — used below to prove a `timeoutMs: null` call
 * has no deadline at all (as opposed to merely a longer one), without
 * actually waiting out a real multi-second timeout in a unit test. */
async function stillPendingAfter(
	promise: Promise<unknown>,
	delayMs: number
): Promise<boolean> {
	const sentinel = Symbol("still-pending");
	const settled = await Promise.race([
		promise.then(
			() => "resolved",
			() => "rejected"
		),
		new Promise((resolve) => setTimeout(() => resolve(sentinel), delayMs)),
	]);
	return settled === sentinel;
}

// Split across several `describe` blocks purely to keep each under the
// repo's max-lines-per-function gate (ESLint counts a `describe` callback's
// own body, including every nested `it`, toward that limit).

describe("createServeHttp - request timeout", () => {
	it("rejects getJson once the request timeout elapses without a reply", async () => {
		vi.stubGlobal("fetch", createHangingFetch());

		const http = createServeHttp(
			"http://127.0.0.1:4242",
			undefined,
			TEST_TIMEOUT_MS
		);

		await expect(http.getJson("/session/ses_1/message")).rejects.toThrow();
	});

	it("rejects postJson once the request timeout elapses without a reply", async () => {
		vi.stubGlobal("fetch", createHangingFetch());

		const http = createServeHttp(
			"http://127.0.0.1:4242",
			undefined,
			TEST_TIMEOUT_MS
		);

		await expect(http.postJson("/session/ses_1/abort")).rejects.toThrow();
	});
});

describe("createServeHttp - RC-T5 per-call timeout override", () => {
	// RC-T5: the long-running turn POST (`POST /session/:id/message`, called
	// via `firePost(..., null)` in opencode-serve.ts) must NOT inherit the
	// short control-call deadline — a turn with tool calls/thinking routinely
	// takes well over `REQUEST_TIMEOUT_MS`, and progress already streams in
	// over SSE separately.
	it("postJson with timeoutMs: null never aborts, even well past the default request timeout", async () => {
		vi.stubGlobal("fetch", createHangingFetch());

		const http = createServeHttp(
			"http://127.0.0.1:4242",
			undefined,
			TEST_TIMEOUT_MS
		);

		const stillPending = await stillPendingAfter(
			http.postJson("/session/ses_1/message", { parts: [] }, null),
			TEST_TIMEOUT_MS * 5
		);

		expect(stillPending).toBe(true);
	});

	it("getJson with timeoutMs: null never aborts either", async () => {
		vi.stubGlobal("fetch", createHangingFetch());

		const http = createServeHttp(
			"http://127.0.0.1:4242",
			undefined,
			TEST_TIMEOUT_MS
		);

		const stillPending = await stillPendingAfter(
			http.getJson("/session/ses_1/message", null),
			TEST_TIMEOUT_MS * 5
		);

		expect(stillPending).toBe(true);
	});

	it("a short control call (no override) still times out at the configured deadline", async () => {
		vi.stubGlobal("fetch", createHangingFetch());

		const http = createServeHttp(
			"http://127.0.0.1:4242",
			undefined,
			TEST_TIMEOUT_MS
		);

		await expect(
			http.postJson("/session/ses_1/abort", undefined, undefined)
		).rejects.toThrow();
	});
});
