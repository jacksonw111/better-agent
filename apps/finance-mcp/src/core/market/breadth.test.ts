import { describe, expect, it } from "vitest";
import { aggregateBreadth, getMarketBreadth } from "./breadth";

describe("aggregateBreadth", () => {
	it("counts advancers/decliners/unchanged and buckets by change pct", () => {
		const agg = aggregateBreadth([
			{ f3: 10.01 }, // upLimit
			{ f3: 8 }, // up7
			{ f3: 5 }, // up5
			{ f3: 3.5 }, // up3
			{ f3: 1 }, // up0
			{ f3: 0 }, // flat
			{ f3: -2 }, // down0
			{ f3: -4 }, // down3
			{ f3: -6 }, // down5
			{ f3: -8 }, // down7
			{ f3: -10 }, // downLimit
		]);
		expect(agg.advancers).toBe(5);
		expect(agg.decliners).toBe(5);
		expect(agg.unchanged).toBe(1);
		expect(agg.total).toBe(11);
		expect(agg.distribution).toEqual({
			upLimit: 1,
			up7: 1,
			up5: 1,
			up3: 1,
			up0: 1,
			flat: 1,
			down0: 1,
			down3: 1,
			down5: 1,
			down7: 1,
			downLimit: 1,
		});
	});

	it("skips suspended rows whose change pct is '-'", () => {
		const agg = aggregateBreadth([{ f3: "-" }, { f3: 1 }, { f3: undefined }]);
		expect(agg.total).toBe(1);
		expect(agg.advancers).toBe(1);
	});
});

// Fetch stub for the merge test: clist rows + a single-limit-up sentiment.
const mergeFetch = ((url: string | URL | Request) => {
	const href = String(url);
	if (href.includes("clist/get")) {
		return Promise.resolve(
			Response.json({ data: { diff: [{ f3: 5 }, { f3: -3 }, { f3: 0 }] } })
		);
	}
	if (href.includes("getTopicZTPool")) {
		return Promise.resolve(
			Response.json({ data: { pool: [{ c: "1", n: "a", lbc: 2 }] } })
		);
	}
	if (href.includes("getTopicZBPool")) {
		return Promise.resolve(Response.json({ data: { pool: [] } }));
	}
	if (href.includes("getTopicDTPool")) {
		return Promise.resolve(Response.json({ data: null }));
	}
	throw new Error(`unexpected URL: ${href}`);
}) as typeof fetch;

describe("getMarketBreadth", () => {
	it("merges the realtime clist snapshot with date-keyed sentiment", async () => {
		const breadth = await getMarketBreadth("20260714", {
			fetchImpl: mergeFetch,
		});
		expect(breadth).toMatchObject({
			date: "20260714",
			advancers: 1,
			decliners: 1,
			unchanged: 1,
			total: 3,
			limitUp: 1,
			limitDown: 0,
			breakBoard: 0,
			maxHeight: 2,
		});
		expect(breadth.ladder).toEqual({ "2": 1 });
	});
});

describe("getMarketBreadth pagination & degradation", () => {
	it("paginates the whole market (100/page) using data.total", async () => {
		// total=250 => 3 pages of 100. Each clist page returns 100 advancers so
		// we can assert all pages were aggregated, not just the first.
		const page = { f3: 1 };
		let clistCalls = 0;
		const fetchImpl = ((url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("clist/get")) {
				clistCalls++;
				return Promise.resolve(
					Response.json({
						data: { total: 250, diff: Array.from({ length: 100 }, () => page) },
					})
				);
			}
			return Promise.resolve(Response.json({ data: null })); // empty sentiment
		}) as typeof fetch;

		const breadth = await getMarketBreadth("20260714", { fetchImpl });
		expect(clistCalls).toBe(3); // ceil(250/100)
		expect(breadth.advancers).toBe(300); // 3 pages × 100
		expect(breadth.total).toBe(300);
	});

	it("degrades to zero breadth when clist is unreachable", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("clist/get")) {
				return Promise.resolve(new Response("boom", { status: 502 }));
			}
			return Promise.resolve(Response.json({ data: null }));
		}) as typeof fetch;
		const breadth = await getMarketBreadth("20260714", { fetchImpl });
		expect(breadth.total).toBe(0);
		expect(breadth.limitUp).toBe(0);
	});
});
