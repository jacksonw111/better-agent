import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getYahooAuth,
	rawNum,
	resetYahooAuthCache,
	yahooQuoteSummary,
} from "./session";

const COOKIE = "A3=d=abc&t=xyz";
const SET_COOKIE = `${COOKIE}; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Domain=.yahoo.com; Path=/`;
const CRUMB = "crumb-123";
const TTL_MS = 30 * 60 * 1000;

// Stub of the two auth legs + quoteSummary; records each URL hit so tests
// can count fetches (cache assertions).
function yahooStub(
	calls: string[],
	summaryPayload: unknown = { quoteSummary: { result: [{ ok: true }] } }
): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		calls.push(href);
		const headers = (init?.headers ?? {}) as Record<string, string>;
		if (href.startsWith("https://fc.yahoo.com")) {
			expect(init?.redirect).toBe("manual");
			return Promise.resolve(
				new Response("", { headers: { "set-cookie": SET_COOKIE } })
			);
		}
		if (href.includes("/v1/test/getcrumb")) {
			// The cookie captured from fc.yahoo.com must be forwarded.
			expect(headers.Cookie).toBe(COOKIE);
			return Promise.resolve(new Response(CRUMB));
		}
		if (href.includes("/v10/finance/quoteSummary/")) {
			expect(headers.Cookie).toBe(COOKIE);
			return Promise.resolve(Response.json(summaryPayload));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

const failingFetch = (() =>
	Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;

beforeEach(() => {
	resetYahooAuthCache();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getYahooAuth: cookie + crumb flow", () => {
	it("returns the set-cookie value (before ';') and the crumb body", async () => {
		const calls: string[] = [];
		const auth = await getYahooAuth({ fetchImpl: yahooStub(calls) });
		expect(auth).toEqual({ cookie: COOKIE, crumb: CRUMB });
		expect(calls).toHaveLength(2);
	});

	it("returns null when no set-cookie header is present", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await getYahooAuth({ fetchImpl })).toBeNull();
	});

	it("returns null when the crumb body is empty", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			if (String(url).startsWith("https://fc.yahoo.com")) {
				return Promise.resolve(
					new Response("", { headers: { "set-cookie": SET_COOKIE } })
				);
			}
			return Promise.resolve(new Response(""));
		}) as typeof fetch;
		expect(await getYahooAuth({ fetchImpl })).toBeNull();
	});
});

describe("getYahooAuth: 30-minute cache", () => {
	it("serves the cached auth without refetching until the TTL lapses", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
		const calls: string[] = [];
		const fetchImpl = yahooStub(calls);
		await getYahooAuth({ fetchImpl });
		await getYahooAuth({ fetchImpl });
		expect(calls).toHaveLength(2);
		nowSpy.mockReturnValue(TTL_MS + 1);
		await getYahooAuth({ fetchImpl });
		expect(calls).toHaveLength(4);
	});

	it("resetYahooAuthCache forces a refetch", async () => {
		const calls: string[] = [];
		const fetchImpl = yahooStub(calls);
		await getYahooAuth({ fetchImpl });
		resetYahooAuthCache();
		await getYahooAuth({ fetchImpl });
		expect(calls).toHaveLength(4);
	});

	it("does not cache failures", async () => {
		expect(await getYahooAuth({ fetchImpl: failingFetch })).toBeNull();
		const calls: string[] = [];
		const auth = await getYahooAuth({ fetchImpl: yahooStub(calls) });
		expect(auth).toEqual({ cookie: COOKIE, crumb: CRUMB });
	});
});

describe("yahooQuoteSummary", () => {
	it("requests the joined modules + crumb and returns result[0]", async () => {
		const calls: string[] = [];
		const result = await yahooQuoteSummary("AAPL", ["earningsTrend", "x"], {
			fetchImpl: yahooStub(calls),
		});
		expect(result).toEqual({ ok: true });
		const summaryUrl = calls.at(-1) ?? "";
		expect(summaryUrl).toContain("/v10/finance/quoteSummary/AAPL");
		expect(summaryUrl).toContain("modules=earningsTrend,x");
		expect(summaryUrl).toContain(`crumb=${CRUMB}`);
	});

	it("returns null on an empty result list or failed auth", async () => {
		const calls: string[] = [];
		const empty = yahooStub(calls, { quoteSummary: { result: [] } });
		expect(
			await yahooQuoteSummary("AAPL", ["x"], { fetchImpl: empty })
		).toBeNull();
		resetYahooAuthCache();
		expect(
			await yahooQuoteSummary("AAPL", ["x"], { fetchImpl: failingFetch })
		).toBeNull();
	});
});

describe("rawNum", () => {
	it("accepts plain numbers and {raw} wrappers, rejects the rest", () => {
		expect(rawNum(42)).toBe(42);
		expect(rawNum({ raw: 1.5, fmt: "1.50" })).toBe(1.5);
		expect(rawNum({ fmt: "1.50" })).toBeNull();
		expect(rawNum("1.5")).toBeNull();
		expect(rawNum(Number.NaN)).toBeNull();
		expect(rawNum(null)).toBeNull();
		expect(rawNum(undefined)).toBeNull();
	});
});
