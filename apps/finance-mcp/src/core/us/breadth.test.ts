import { describe, expect, it } from "vitest";
import {
	aggregateUsBreadth,
	getUsMarketBreadth,
	parsePctChange,
} from "./breadth";

const DATE = "2026-08-14";

describe("parsePctChange", () => {
	it("parses %-suffixed strings and rejects halted/blank rows", () => {
		expect(parsePctChange("-0.509%")).toBe(-0.509);
		expect(parsePctChange("13.514%")).toBe(13.514);
		expect(parsePctChange("0.00%")).toBe(0);
		expect(parsePctChange("--")).toBeNull();
		expect(parsePctChange("")).toBeNull();
		expect(parsePctChange(null)).toBeNull();
	});
});

describe("aggregateUsBreadth", () => {
	it("counts advancers/decliners/unchanged into open-ended buckets", () => {
		const rows = [
			{ pctchange: "12.5%" }, // up10
			{ pctchange: "7.2%" }, // up7
			{ pctchange: "3.1%" }, // up3
			{ pctchange: "0.4%" }, // up0
			{ pctchange: "0.00%" }, // flat
			{ pctchange: "-1.2%" }, // down0
			{ pctchange: "-5.5%" }, // down5
			{ pctchange: "-13.514%" }, // down10
			{ pctchange: "--" }, // halted, excluded from total
		];
		const breadth = aggregateUsBreadth(rows, DATE);
		expect(breadth).toEqual({
			advancers: 4,
			date: DATE,
			decliners: 3,
			distribution: {
				up10: 1,
				up7: 1,
				up5: 0,
				up3: 1,
				up0: 1,
				flat: 1,
				down0: 1,
				down3: 0,
				down5: 1,
				down7: 0,
				down10: 1,
			},
			medianChangePct: 0.2,
			total: 8,
			unchanged: 1,
		});
	});
});

describe("getUsMarketBreadth", () => {
	it("fetches the nasdaq screener and aggregates rows", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			expect(String(url)).toContain("api.nasdaq.com/api/screener/stocks");
			return Promise.resolve(
				Response.json({
					data: { rows: [{ pctchange: "1.0%" }, { pctchange: "-2.0%" }] },
				})
			);
		}) as typeof fetch;
		const breadth = await getUsMarketBreadth({ fetchImpl, today: DATE });
		expect(breadth).toMatchObject({
			advancers: 1,
			date: DATE,
			decliners: 1,
			total: 2,
		});
	});

	it("degrades to null on HTTP error or an empty universe", async () => {
		const failing = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await getUsMarketBreadth({ fetchImpl: failing })).toBeNull();

		const empty = (() =>
			Promise.resolve(Response.json({ data: { rows: [] } }))) as typeof fetch;
		expect(await getUsMarketBreadth({ fetchImpl: empty })).toBeNull();
	});
});
