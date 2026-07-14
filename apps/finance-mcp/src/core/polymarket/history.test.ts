import { describe, expect, it } from "vitest";
import {
	downsampleEvenly,
	findMatchingMarket,
	getPredictionHistory,
	type RawGammaMarket,
} from "./history";

const SECONDS_PER_HOUR = 3600;
const T0 = Date.UTC(2026, 5, 1, 12, 30) / 1000;

function gammaFixture(overrides: Partial<RawGammaMarket> = {}): RawGammaMarket {
	return {
		question: "Will the Fed cut rates in September?",
		slug: "fed-cut-september",
		outcomes: '["Yes","No"]',
		clobTokenIds: '["yes-token-123","no-token-456"]',
		...overrides,
	};
}

function historyBody(count: number): { history: { t: number; p: number }[] } {
	return {
		history: Array.from({ length: count }, (_, i) => ({
			t: T0 + i * SECONDS_PER_HOUR,
			p: 0.4 + i * 0.001,
		})),
	};
}

function stubFetch(
	markets: RawGammaMarket[],
	history: { history: { t: number; p: number }[] },
	urls: string[]
): typeof fetch {
	const fetchImpl = (url: string | URL | Request) => {
		const href = String(url);
		urls.push(href);
		if (href.startsWith("https://clob.polymarket.com/prices-history")) {
			return Promise.resolve(Response.json(history));
		}
		return Promise.resolve(Response.json(markets));
	};
	return fetchImpl as typeof fetch;
}

describe("getPredictionHistory happy path", () => {
	it("resolves the Yes token and returns formatted UTC points", async () => {
		const urls: string[] = [];
		const fetchImpl = stubFetch([gammaFixture()], historyBody(3), urls);
		const result = await getPredictionHistory("fed", "1w", { fetchImpl });
		expect(urls[0]).toBe(
			"https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=100"
		);
		expect(urls[1]).toBe(
			"https://clob.polymarket.com/prices-history?market=yes-token-123&interval=1w&fidelity=720"
		);
		expect(result).toMatchObject({
			question: "Will the Fed cut rates in September?",
			slug: "fed-cut-september",
			outcome: "Yes",
			interval: "1w",
		});
		expect(result?.points[0]).toEqual({
			time: "2026-06-01 12:30",
			probability: 0.4,
		});
		expect(result?.points).toHaveLength(3);
	});

	it("coerces an unknown interval to 1w in both URL and result", async () => {
		const urls: string[] = [];
		const fetchImpl = stubFetch([gammaFixture()], historyBody(2), urls);
		const result = await getPredictionHistory("", "banana", { fetchImpl });
		expect(urls[1]).toContain("interval=1w");
		expect(result?.interval).toBe("1w");
	});
});

describe("getPredictionHistory null cases", () => {
	it("returns null when no market matches the query", async () => {
		const urls: string[] = [];
		const fetchImpl = stubFetch([gammaFixture()], historyBody(2), urls);
		const result = await getPredictionHistory("zzz-no-match", "1w", {
			fetchImpl,
		});
		expect(result).toBeNull();
		expect(urls).toHaveLength(1);
	});

	it("returns null when clobTokenIds is malformed JSON", async () => {
		const markets = [gammaFixture({ clobTokenIds: "not-json" })];
		const fetchImpl = stubFetch(markets, historyBody(2), []);
		const result = await getPredictionHistory("fed", "1w", { fetchImpl });
		expect(result).toBeNull();
	});

	it("returns null when the history comes back empty", async () => {
		const fetchImpl = stubFetch([gammaFixture()], { history: [] }, []);
		const result = await getPredictionHistory("fed", "1w", { fetchImpl });
		expect(result).toBeNull();
	});

	it("returns null on an upstream error status", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("nope", { status: 404 }));
		const result = await getPredictionHistory("fed", "1w", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toBeNull();
	});
});

describe("findMatchingMarket", () => {
	const markets = [
		gammaFixture({ question: "Will BTC hit 200k?", slug: "btc" }),
		gammaFixture({ question: "Will the Fed cut rates?", slug: "fed" }),
	];

	it("matches case-insensitively on the question", () => {
		expect(findMatchingMarket(markets, "FED")?.slug).toBe("fed");
	});

	it("returns the top market for an empty query", () => {
		expect(findMatchingMarket(markets, "")?.slug).toBe("btc");
	});

	it("returns null when nothing matches", () => {
		expect(findMatchingMarket(markets, "aliens")).toBeNull();
	});
});

describe("downsampleEvenly", () => {
	it("downsamples >100 points evenly to exactly 100, keeping endpoints", () => {
		const points = Array.from({ length: 250 }, (_, i) => i);
		const sampled = downsampleEvenly(points, 100);
		expect(sampled).toHaveLength(100);
		expect(sampled[0]).toBe(0);
		expect(sampled.at(-1)).toBe(249);
	});

	it("returns short series unchanged", () => {
		const points = [1, 2, 3];
		expect(downsampleEvenly(points, 100)).toEqual([1, 2, 3]);
	});

	it("caps getPredictionHistory points at 100", async () => {
		const fetchImpl = stubFetch([gammaFixture()], historyBody(250), []);
		const result = await getPredictionHistory("", "1d", { fetchImpl });
		expect(result?.points).toHaveLength(100);
	});
});
