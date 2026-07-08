import { describe, expect, it } from "vitest";
import { hkEarnings, parseHkexEarnings } from "./hkex-earnings";

const ROWS = [
	{
		STOCK_CODE: "00700",
		STOCK_NAME: "TENCENT",
		DATE_TIME: "07/07/2026 22:21",
		LONG_TEXT: "Announcements and Notices - [Interim Results]",
	},
	{
		STOCK_CODE: "07687",
		STOCK_NAME: "EACON",
		DATE_TIME: "07/07/2026 22:48",
		LONG_TEXT: "Announcements and Notices - [Allotment Results]",
	},
];

describe("parseHkexEarnings", () => {
	it("filters to results/board-meeting rows and normalizes date, from a JSON-string result", () => {
		const events = parseHkexEarnings({ result: JSON.stringify(ROWS) });
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			market: "hk",
			symbol: "00700",
			name: "TENCENT",
			date: "2026-07-07",
			reportType: "Interim Results",
		});
	});

	it("also accepts result already as an array (not a JSON string)", () => {
		const events = parseHkexEarnings({ result: ROWS });
		expect(events).toHaveLength(1);
		expect(events[0]?.symbol).toBe("00700");
	});
});

describe("hkEarnings", () => {
	it("fetches HKEXnews and returns the filtered/normalized events", async () => {
		const fetchImpl = () =>
			Promise.resolve(Response.json({ result: JSON.stringify(ROWS) }));
		const events = await hkEarnings("2026-07-07", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toEqual([
			{
				market: "hk",
				symbol: "00700",
				name: "TENCENT",
				date: "2026-07-07",
				reportType: "Interim Results",
			},
		]);
	});

	it("degrades to [] on a non-ok response", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("nope", { status: 404 }));
		const events = await hkEarnings("2026-07-07", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events).toEqual([]);
	});
});
