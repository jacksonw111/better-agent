import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "./economic";
import { getYieldCurve } from "./yield-curve";

describe("getYieldCurve: config", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(getYieldCurve("")).rejects.toBeInstanceOf(NotConfiguredError);
	});
});

describe("getYieldCurve: normalization", () => {
	it("returns points in tenor order with numeric yields, skipping failures", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("series_id=DGS1&")) {
				return Promise.resolve(
					Response.json({
						observations: [{ date: "2026-07-07", value: "4.35" }],
					})
				);
			}
			if (href.includes("series_id=DGS10")) {
				return Promise.resolve(
					Response.json({
						observations: [
							{ date: "2026-07-07", value: "." },
							{ date: "2026-07-06", value: "4.21" },
						],
					})
				);
			}
			return Promise.resolve(new Response("boom", { status: 500 }));
		};
		const points = await getYieldCurve("KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(points).toHaveLength(2);
		expect(points.map((p) => p.tenor)).toEqual(["1Y", "10Y"]);
		expect(points[0]).toMatchObject({
			tenor: "1Y",
			seriesId: "DGS1",
			date: "2026-07-07",
			yield: 4.35,
		});
		expect(points[1]).toMatchObject({
			tenor: "10Y",
			seriesId: "DGS10",
			date: "2026-07-06",
			yield: 4.21,
		});
	});
});
