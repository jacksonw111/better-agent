import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "./economic";
import { getMacroUs } from "./macro";

const CPI_PAYLOAD = {
	observations: [
		{ date: "2026-05-01", value: "333.979" },
		{ date: "2026-04-01", value: "." },
	],
};

describe("getMacroUs: config", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(getMacroUs("cpi", 12, "")).rejects.toBeInstanceOf(
			NotConfiguredError
		);
	});
});

describe("getMacroUs: single indicator", () => {
	it("normalizes observations and skips '.' missing values", async () => {
		const fetchImpl = () => Promise.resolve(Response.json(CPI_PAYLOAD));
		const result = await getMacroUs("cpi", 12, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(result).toMatchObject({ indicator: "cpi", seriesId: "CPIAUCSL" });
		expect("observations" in result && result.observations).toEqual([
			{ date: "2026-05-01", value: 333.979 },
		]);
	});

	it("returns an empty series for an unknown indicator without fetching", async () => {
		const result = await getMacroUs("not_a_real_indicator", 12, "KEY");
		expect(result).toEqual({
			indicator: "not_a_real_indicator",
			seriesId: null,
			observations: [],
		});
	});
});

describe("getMacroUs: dashboard", () => {
	it("fetches the curated dashboard set concurrently when indicator is omitted", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("series_id=CPIAUCSL")) {
				return Promise.resolve(Response.json(CPI_PAYLOAD));
			}
			return Promise.resolve(new Response("boom", { status: 500 }));
		};
		const result = await getMacroUs(undefined, 12, "KEY", {
			fetchImpl: fetchImpl as typeof fetch,
			signal: undefined,
		});
		expect("dashboard" in result).toBe(true);
		const dashboard = "dashboard" in result ? result.dashboard : [];
		const cpiRow = dashboard.find((r) => r.indicator === "cpi");
		expect(cpiRow).toMatchObject({
			indicator: "cpi",
			seriesId: "CPIAUCSL",
			date: "2026-05-01",
			value: 333.979,
		});
		const unemploymentRow = dashboard.find(
			(r) => r.indicator === "unemployment"
		);
		expect(unemploymentRow).toMatchObject({
			indicator: "unemployment",
			seriesId: "UNRATE",
			date: null,
			value: null,
		});
	});
});
