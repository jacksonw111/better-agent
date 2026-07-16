import { describe, expect, it } from "vitest";
import {
	buildValuation,
	getIndexValuation,
	resolveIndexCode,
	verdictFor,
} from "./index-valuation";

describe("resolveIndexCode", () => {
	it("resolves canonical names, aliases, and raw codes", () => {
		expect(resolveIndexCode("沪深300")).toEqual({
			name: "沪深300",
			code: "000300.SH",
		});
		expect(resolveIndexCode("hs300")).toEqual({
			name: "沪深300",
			code: "000300.SH",
		});
		expect(resolveIndexCode("000905")).toEqual({
			name: "中证500",
			code: "000905.SH",
		});
		expect(resolveIndexCode("000300.SH")).toEqual({
			name: "沪深300",
			code: "000300.SH",
		});
	});

	it("returns null for an unsupported symbol", () => {
		expect(resolveIndexCode("特斯拉")).toBeNull();
	});
});

describe("verdictFor", () => {
	it("maps TTM PE percentile to a verdict band", () => {
		expect(verdictFor(10)).toBe("低估");
		expect(verdictFor(30)).toBe("偏低");
		expect(verdictFor(50)).toBe("合理");
		expect(verdictFor(70)).toBe("偏高");
		expect(verdictFor(90)).toBe("高估");
		expect(verdictFor(null)).toBe("未知");
	});
});

describe("buildValuation", () => {
	it("takes the latest PE + PB rows and converts quantiles to percent", () => {
		const v = buildValuation(
			"沪深300",
			"000300.SH",
			[
				{ date: "2026-07-14", ttmPe: 30, ttmPeQuantile: 0.5, lyrPe: 32 },
				{
					date: "2026-07-15",
					ttmPe: 35.72,
					ttmPeQuantile: 0.655_51,
					lyrPe: 40.16,
					lyrPeQuantile: 0.669_44,
				},
			],
			[{ date: "2026-07-15", pb: 4.66, pbQuantile: 0.813_24 }]
		);
		expect(v).toEqual({
			index: "沪深300",
			indexCode: "000300.SH",
			date: "2026-07-15",
			peTtm: 35.72,
			peTtmPercentile: 65.6,
			peLyr: 40.16,
			peLyrPercentile: 66.9,
			pb: 4.66,
			pbPercentile: 81.3,
			verdict: "偏高",
		});
	});

	it("returns null when both series are empty", () => {
		expect(buildValuation("沪深300", "000300.SH", [], [])).toBeNull();
	});
});

describe("getIndexValuation", () => {
	it("runs the CSRF page fetch then the PE/PB calls and assembles a snapshot", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/stockdata/sz50-ttm-lyr")) {
				return Promise.resolve(
					new Response('<meta name="_csrf" content="tok123">', {
						headers: {
							date: "Wed, 15 Jul 2026 01:00:00 GMT",
							"set-cookie": "JSESSIONID=abc; Path=/",
						},
					})
				);
			}
			if (href.includes("index-basic-pe")) {
				expect(href).toContain("indexCode=000300.SH");
				return Promise.resolve(
					Response.json({
						data: [
							{ date: "2026-07-15", ttmPe: 12, ttmPeQuantile: 0.1, lyrPe: 13 },
						],
					})
				);
			}
			return Promise.resolve(
				Response.json({
					data: [{ date: "2026-07-15", pb: 1.2, pbQuantile: 0.15 }],
				})
			);
		}) as typeof fetch;

		const v = await getIndexValuation("沪深300", { fetchImpl });
		expect(v).toMatchObject({
			index: "沪深300",
			peTtm: 12,
			peTtmPercentile: 10,
			pb: 1.2,
			pbPercentile: 15,
			verdict: "低估",
		});
	});

	it("returns null for an unsupported symbol without any fetch", async () => {
		let called = false;
		const fetchImpl = (() => {
			called = true;
			return Promise.resolve(new Response("{}"));
		}) as typeof fetch;
		expect(await getIndexValuation("茅台", { fetchImpl })).toBeNull();
		expect(called).toBe(false);
	});
});
