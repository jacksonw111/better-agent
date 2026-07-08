import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "./http";

describe("fetchWithRetry: no-retry paths", () => {
	it("returns immediately on 200 (no retry)", async () => {
		let calls = 0;
		const fetchImpl = (): Promise<Response> => {
			calls++;
			return Promise.resolve(new Response("", { status: 200 }));
		};
		const res = await fetchWithRetry(
			"https://example.test",
			{},
			{ fetchImpl: fetchImpl as typeof fetch, backoffBaseMs: 0 }
		);
		expect(res.status).toBe(200);
		expect(calls).toBe(1);
	});

	it("does not retry a non-retryable 404", async () => {
		let calls = 0;
		const fetchImpl = (): Promise<Response> => {
			calls++;
			return Promise.resolve(new Response("", { status: 404 }));
		};
		const res = await fetchWithRetry(
			"https://example.test",
			{},
			{ fetchImpl: fetchImpl as typeof fetch, backoffBaseMs: 0 }
		);
		expect(res.status).toBe(404);
		expect(calls).toBe(1);
	});
});

describe("fetchWithRetry: retry paths", () => {
	it("retries on 500 then succeeds", async () => {
		let calls = 0;
		const fetchImpl = (): Promise<Response> => {
			calls++;
			if (calls < 3) {
				return Promise.resolve(new Response("", { status: 500 }));
			}
			return Promise.resolve(new Response("", { status: 200 }));
		};
		const res = await fetchWithRetry(
			"https://example.test",
			{},
			{ fetchImpl: fetchImpl as typeof fetch, backoffBaseMs: 0 }
		);
		expect(res.status).toBe(200);
		expect(calls).toBe(3);
	});

	it("exhausts retries and returns the last error response (does not throw)", async () => {
		let calls = 0;
		const fetchImpl = (): Promise<Response> => {
			calls++;
			return Promise.resolve(new Response("", { status: 503 }));
		};
		const res = await fetchWithRetry(
			"https://example.test",
			{},
			{ fetchImpl: fetchImpl as typeof fetch, backoffBaseMs: 0, retries: 2 }
		);
		expect(res.status).toBe(503);
		expect(calls).toBe(3);
	});

	it("retries a thrown network error then succeeds", async () => {
		let calls = 0;
		const fetchImpl = (): Promise<Response> => {
			calls++;
			if (calls === 1) {
				return Promise.reject(new Error("network down"));
			}
			return Promise.resolve(new Response("", { status: 200 }));
		};
		const res = await fetchWithRetry(
			"https://example.test",
			{},
			{ fetchImpl: fetchImpl as typeof fetch, backoffBaseMs: 0 }
		);
		expect(res.status).toBe(200);
		expect(calls).toBe(2);
	});
});
