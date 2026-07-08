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
