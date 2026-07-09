import { describe, expect, it } from "vitest";
import {
	SKILL_VERSION,
	WereadApiError,
	wereadCall,
} from "./core/weread-client";

interface Captured {
	body: string;
	headers: Record<string, string>;
}

function stubFetch(response: unknown, status = 200) {
	const captured: Captured = { body: "", headers: {} };
	const orig = globalThis.fetch;
	globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
		captured.body = typeof init?.body === "string" ? init.body : "";
		const h = init?.headers as Record<string, string> | undefined;
		captured.headers = h ?? {};
		return Promise.resolve(new Response(JSON.stringify(response), { status }));
	}) as typeof fetch;
	return {
		captured,
		restore() {
			globalThis.fetch = orig;
		},
	};
}

describe("wereadCall", () => {
	it("sends POST with api_name, skill_version, and bearer auth", async () => {
		const stub = stubFetch({ errcode: 0, books: [] });
		try {
			await wereadCall("wrk-test-key", "/store/search", {
				keyword: "三体",
				scope: 10,
			});
			const parsed = JSON.parse(stub.captured.body) as Record<string, unknown>;
			expect(parsed.api_name).toBe("/store/search");
			expect(parsed.skill_version).toBe(SKILL_VERSION);
			expect(parsed.keyword).toBe("三体");
			expect(parsed.scope).toBe(10);
			expect(stub.captured.headers.authorization).toBe("Bearer wrk-test-key");
			expect(stub.captured.headers["content-type"]).toBe("application/json");
		} finally {
			stub.restore();
		}
	});

	it("returns the gateway JSON body on success", async () => {
		const stub = stubFetch({ errcode: 0, title: "三体" });
		try {
			const out = await wereadCall("k", "/book/info", { bookId: "1" });
			expect(out).toEqual({ errcode: 0, title: "三体" });
		} finally {
			stub.restore();
		}
	});

	it("throws WereadApiError on non-zero errcode", async () => {
		const stub = stubFetch({ errcode: -1, errmsg: "bad request" });
		try {
			await expect(wereadCall("k", "/x", {})).rejects.toBeInstanceOf(
				WereadApiError
			);
			await expect(wereadCall("k", "/x", {})).rejects.toThrow("bad request");
		} finally {
			stub.restore();
		}
	});

	it("throws WereadApiError on HTTP failure", async () => {
		const stub = stubFetch({}, 500);
		try {
			await expect(wereadCall("k", "/x", {})).rejects.toThrow("HTTP 500");
		} finally {
			stub.restore();
		}
	});

	it("flattens params at top level (no params nesting)", async () => {
		const stub = stubFetch({ errcode: 0 });
		try {
			await wereadCall("k", "/user/notebooks", { count: 100, lastSort: 42 });
			const parsed = JSON.parse(stub.captured.body) as Record<string, unknown>;
			expect(parsed.count).toBe(100);
			expect(parsed.lastSort).toBe(42);
			expect(parsed.params).toBeUndefined();
		} finally {
			stub.restore();
		}
	});
});
