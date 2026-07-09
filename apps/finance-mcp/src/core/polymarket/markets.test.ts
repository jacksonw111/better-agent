import { describe, expect, it } from "vitest";
import { getPredictionMarkets } from "./markets";

function marketFixture(
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		id: "111",
		question: "Will X happen?",
		slug: "will-x-happen",
		endDate: "2026-12-31T00:00:00Z",
		liquidity: "12345.67",
		volume: "98765.43",
		description: "desc",
		outcomes: '["Yes","No"]',
		outcomePrices: '["0.03","0.97"]',
		active: true,
		closed: false,
		...overrides,
	};
}

describe("getPredictionMarkets normalization", () => {
	it("parses JSON-string outcomes/outcomePrices into zipped probabilities", async () => {
		const fetchImpl = () => Promise.resolve(Response.json([marketFixture()]));
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toHaveLength(1);
		expect(markets[0]).toMatchObject({
			id: "111",
			question: "Will X happen?",
			slug: "will-x-happen",
			endDate: "2026-12-31",
			volumeUsd: 98_765.43,
			liquidityUsd: 12_345.67,
			outcomes: [
				{ name: "Yes", probability: 0.03 },
				{ name: "No", probability: 0.97 },
			],
		});
	});
});

describe("getPredictionMarkets query filter", () => {
	it("keeps only markets whose question contains the query (case-insensitive)", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				Response.json([
					marketFixture({ id: "1", question: "Will the Fed cut rates?" }),
					marketFixture({ id: "2", question: "Will it rain tomorrow?" }),
				])
			);
		const markets = await getPredictionMarkets("fed", 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toHaveLength(1);
		expect(markets[0]?.id).toBe("1");
	});
});

describe("getPredictionMarkets edge cases", () => {
	it("skips a market with malformed outcomes JSON instead of throwing", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				Response.json([
					marketFixture({ id: "1", outcomes: "not-json" }),
					marketFixture({ id: "2" }),
				])
			);
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toHaveLength(1);
		expect(markets[0]?.id).toBe("2");
	});

	it("skips a market whose outcomes/outcomePrices lengths mismatch", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				Response.json([marketFixture({ outcomePrices: '["0.03"]' })])
			);
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toEqual([]);
	});

	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("nope", { status: 500 }));
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets).toEqual([]);
	});
});

describe("getPredictionMarkets: live CLOB midpoints", () => {
	it("enriches each outcome's probability with the live CLOB midpoint", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.startsWith("https://clob.polymarket.com/midpoint")) {
				const mid = href.includes("token_id=yes-token") ? "0.05" : "0.95";
				return Promise.resolve(Response.json({ mid }));
			}
			return Promise.resolve(
				Response.json([
					marketFixture({ clobTokenIds: '["yes-token","no-token"]' }),
				])
			);
		};
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets[0]?.outcomes).toEqual([
			{ name: "Yes", probability: 0.05, livePrice: true },
			{ name: "No", probability: 0.95, livePrice: true },
		]);
	});

	it("falls back to the Gamma outcomePrices value when a midpoint fetch fails", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.startsWith("https://clob.polymarket.com/midpoint")) {
				return Promise.resolve(new Response("boom", { status: 500 }));
			}
			return Promise.resolve(
				Response.json([
					marketFixture({ clobTokenIds: '["yes-token","no-token"]' }),
				])
			);
		};
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets[0]?.outcomes[0]).toMatchObject({
			name: "Yes",
			probability: 0.03,
		});
		expect(markets[0]?.outcomes[0]?.livePrice).toBeUndefined();
	});
});

describe("getPredictionMarkets: live CLOB midpoints — skip cases", () => {
	it("skips enrichment (no CLOB call) when clobTokenIds is missing", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.startsWith("https://clob.polymarket.com/midpoint")) {
				throw new Error("must not fetch midpoint without clobTokenIds");
			}
			return Promise.resolve(Response.json([marketFixture()]));
		};
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets[0]?.outcomes[0]).toMatchObject({
			name: "Yes",
			probability: 0.03,
		});
	});

	it("skips enrichment when clobTokenIds length mismatches outcomes", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.startsWith("https://clob.polymarket.com/midpoint")) {
				throw new Error("must not fetch midpoint on length mismatch");
			}
			return Promise.resolve(
				Response.json([marketFixture({ clobTokenIds: '["yes-token"]' })])
			);
		};
		const markets = await getPredictionMarkets(undefined, 12, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(markets[0]?.outcomes[0]).toMatchObject({
			name: "Yes",
			probability: 0.03,
		});
	});
});
