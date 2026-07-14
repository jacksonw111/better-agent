import { beforeEach, describe, expect, it } from "vitest";
import { getUsOptions } from "./options";
import { resetYahooAuthCache } from "./session";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";

const CHAIN_PAYLOAD = {
	optionChain: {
		result: [
			{
				quote: { regularMarketPrice: 231.5 },
				expirationDates: [1_750_000_000, 1_752_000_000],
				options: [
					{
						calls: [
							{
								contractSymbol: "AAPL250620C00230000",
								strike: { raw: 230, fmt: "230.00" },
								lastPrice: { raw: 5.2 },
								bid: { raw: 5.1 },
								ask: { raw: 5.3 },
								volume: 1200,
								openInterest: 3400,
								impliedVolatility: { raw: 0.31 },
								inTheMoney: true,
							},
						],
						puts: [
							{
								contractSymbol: "AAPL250620P00230000",
								strike: { raw: 230 },
								lastPrice: { raw: 4.8 },
								bid: { raw: 4.7 },
								ask: { raw: 4.9 },
								volume: { raw: 900 },
								openInterest: { raw: 2100 },
								impliedVolatility: { raw: 0.29 },
								inTheMoney: false,
							},
						],
					},
				],
			},
		],
	},
};

// Serves the two auth legs plus the options endpoint; records option URLs.
function stubFor(optionUrls: string[]): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.startsWith("https://fc.yahoo.com")) {
			return Promise.resolve(
				new Response("", { headers: { "set-cookie": SET_COOKIE } })
			);
		}
		if (href.includes("/v1/test/getcrumb")) {
			return Promise.resolve(new Response("crumb-1"));
		}
		if (href.includes("/v7/finance/options/")) {
			optionUrls.push(href);
			return Promise.resolve(Response.json(CHAIN_PAYLOAD));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

beforeEach(() => {
	resetYahooAuthCache();
});

describe("getUsOptions: happy path", () => {
	it("parses {raw} wrappers and plain numbers into typed rows", async () => {
		const urls: string[] = [];
		const chain = await getUsOptions("AAPL", undefined, {
			fetchImpl: stubFor(urls),
		});
		expect(chain.underlyingPrice).toBe(231.5);
		expect(chain.expirationDates).toEqual([1_750_000_000, 1_752_000_000]);
		expect(chain.calls[0]).toEqual({
			contractSymbol: "AAPL250620C00230000",
			strike: 230,
			lastPrice: 5.2,
			bid: 5.1,
			ask: 5.3,
			volume: 1200,
			openInterest: 3400,
			impliedVolatility: 0.31,
			inTheMoney: true,
		});
		expect(chain.puts[0]).toMatchObject({
			volume: 900,
			openInterest: 2100,
			inTheMoney: false,
		});
	});

	it("appends date= only when an expiration is given", async () => {
		const urls: string[] = [];
		const fetchImpl = stubFor(urls);
		await getUsOptions("AAPL", 1_752_000_000, { fetchImpl });
		await getUsOptions("AAPL", undefined, { fetchImpl });
		expect(urls[0]).toContain("&date=1752000000");
		expect(urls[0]).toContain("crumb=crumb-1");
		expect(urls[1]).not.toContain("date=");
	});
});

describe("getUsOptions: degradation", () => {
	it("returns an empty chain when auth fails", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		const chain = await getUsOptions("AAPL", undefined, { fetchImpl });
		expect(chain).toEqual({
			underlyingPrice: null,
			expirationDates: [],
			calls: [],
			puts: [],
		});
	});

	it("returns an empty chain when the options endpoint errors", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			const href = String(url);
			if (href.startsWith("https://fc.yahoo.com")) {
				return Promise.resolve(
					new Response("", { headers: { "set-cookie": SET_COOKIE } })
				);
			}
			if (href.includes("/v1/test/getcrumb")) {
				return Promise.resolve(new Response("crumb-1"));
			}
			return Promise.resolve(new Response("nope", { status: 404 }));
		}) as typeof fetch;
		const chain = await getUsOptions("AAPL", undefined, { fetchImpl });
		expect(chain.calls).toEqual([]);
		expect(chain.puts).toEqual([]);
		expect(chain.underlyingPrice).toBeNull();
	});
});
