import { describe, expect, it } from "vitest";
import { getEarningsForecast } from "./forecast";

function jsonpResponse(rows: unknown[]): Response {
	return new Response(`jsonp(${JSON.stringify({ data: rows })})`);
}

describe("getEarningsForecast consensus", () => {
	it("averages recent research report predictions into a 3-row consensus", async () => {
		const rows = [
			{
				infoCode: "AP1",
				publishDate: "2026-06-01 00:00:00",
				predictThisYearEps: "10",
				predictNextYearEps: "12",
				predictNextTwoYearEps: "14",
				predictThisYearPe: "20",
				predictNextYearPe: "18",
				predictNextTwoYearPe: "16",
			},
			{
				infoCode: "AP2",
				publishDate: "2026-06-02 00:00:00",
				predictThisYearEps: "12",
				predictNextYearEps: "14",
				predictNextTwoYearEps: "16",
				predictThisYearPe: "22",
				predictNextYearPe: "20",
				predictNextTwoYearPe: "18",
			},
		];
		const fetchImpl = () => Promise.resolve(jsonpResponse(rows));
		const forecast = await getEarningsForecast("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
			now: Date.parse("2026-07-08"),
		});
		expect(forecast).toEqual([
			{ year: "2026", eps: 11, pe: 21 },
			{ year: "2027", eps: 13, pe: 19 },
			{ year: "2028", eps: 15, pe: 17 },
		]);
	});
});

describe("getEarningsForecast edge cases", () => {
	it("returns [] for non-A-share symbols without hitting the network", async () => {
		let calls = 0;
		const fetchImpl = () => {
			calls++;
			return Promise.resolve(jsonpResponse([]));
		};
		const forecast = await getEarningsForecast("AAPL", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(forecast).toEqual([]);
		expect(calls).toBe(0);
	});

	it("returns [] when there are no recent reports", async () => {
		const fetchImpl = () => Promise.resolve(jsonpResponse([]));
		const forecast = await getEarningsForecast("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
			now: Date.parse("2026-07-08"),
		});
		expect(forecast).toEqual([]);
	});
});
