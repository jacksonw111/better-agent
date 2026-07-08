import { describe, expect, it } from "vitest";
import { getMacroCn } from "./macro";

const CPI_PAYLOAD = {
	result: {
		data: [
			{
				TIME: "2026年5月",
				NATIONAL_SAME: 0.1,
				NATIONAL_SEQUENTIAL: -0.2,
				NATIONAL_ACCUMULATE: 0.3,
			},
		],
	},
};

describe("getMacroCn: single indicator", () => {
	it("maps CPI rows to {time, yoy, mom, cumulative}", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(CPI_PAYLOAD));
		const result = await getMacroCn("cpi", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toMatchObject({
			indicator: "cpi",
			rows: [{ time: "2026年5月", yoy: 0.1, mom: -0.2, cumulative: 0.3 }],
		});
	});

	it("degrades to empty rows for an unknown indicator without fetching", async () => {
		const result = await getMacroCn("not_real");
		expect(result).toEqual({ indicator: "not_real", rows: [] });
	});

	it("degrades to empty rows on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 500 }));
		const result = await getMacroCn("cpi", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toEqual({ indicator: "cpi", rows: [] });
	});
});

describe("getMacroCn: m2 field mapping", () => {
	it("leaves m2/m2Yoy null pending a confirmed EastMoney field", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				Response.json({
					result: {
						data: [
							{
								TIME: "2026年5月",
								BASIC_CURRENCY: 12.1,
								BASIC_CURRENCY_SAME: 1.1,
								CURRENCY: 68.2,
								CURRENCY_SAME: 4.7,
							},
						],
					},
				})
			);
		const result = await getMacroCn("m2", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toMatchObject({
			indicator: "m2",
			rows: [
				{
					time: "2026年5月",
					m0: 12.1,
					m0Yoy: 1.1,
					m1: 68.2,
					m1Yoy: 4.7,
					m2: null,
					m2Yoy: null,
				},
			],
		});
	});
});

describe("getMacroCn: dashboard", () => {
	it("fetches the latest row of each indicator concurrently when omitted", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("reportName=RPT_ECONOMY_CPI")) {
				return Promise.resolve(Response.json(CPI_PAYLOAD));
			}
			return Promise.resolve(new Response("boom", { status: 500 }));
		};
		const result = await getMacroCn(undefined, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect("dashboard" in result).toBe(true);
		const dashboard = "dashboard" in result ? result.dashboard : [];
		const cpi = dashboard.find((d) => d.indicator === "cpi");
		expect(cpi?.latest).toMatchObject({ time: "2026年5月", yoy: 0.1 });
		const ppi = dashboard.find((d) => d.indicator === "ppi");
		expect(ppi?.latest).toBeNull();
	});
});
