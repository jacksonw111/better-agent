import { describe, expect, it } from "vitest";
import { getUsTradeCalendar, parseUsTradeCalendar } from "./trade-calendar";

const KLINE_PAYLOAD = {
	code: 0,
	data: {
		"us.INX": {
			day: [
				[
					"2026-08-13",
					"7763.18",
					"7798.99",
					"7816.70",
					"7763.18",
					"2684931044",
				],
				[
					"2026-08-14",
					"7806.60",
					"7785.76",
					"7810.01",
					"7776.31",
					"2210210197",
				],
			],
		},
	},
};

function stubFor(payload: unknown, status = 200): typeof fetch {
	return ((url: string | URL | Request) => {
		expect(String(url)).toContain("param=us.INX,day");
		return Promise.resolve(
			status === 200 ? Response.json(payload) : new Response("", { status })
		);
	}) as typeof fetch;
}

describe("parseUsTradeCalendar", () => {
	it("marks today as a trading day when the last bar is dated today (ET)", () => {
		expect(parseUsTradeCalendar(KLINE_PAYLOAD, "2026-08-14")).toEqual({
			isTodayTradingDay: true,
			lastTradeDate: "2026-08-14",
			tradeDays: ["2026-08-13", "2026-08-14"],
		});
	});

	it("marks a weekend/holiday as non-trading", () => {
		expect(
			parseUsTradeCalendar(KLINE_PAYLOAD, "2026-08-15")?.isTodayTradingDay
		).toBe(false);
	});

	it("returns null when the series is empty", () => {
		expect(parseUsTradeCalendar({ data: {} }, "2026-08-14")).toBeNull();
	});
});

describe("getUsTradeCalendar", () => {
	it("fetches the S&P 500 daily kline and parses it", async () => {
		const cal = await getUsTradeCalendar({
			fetchImpl: stubFor(KLINE_PAYLOAD),
			today: "2026-08-14",
		});
		expect(cal?.lastTradeDate).toBe("2026-08-14");
	});

	it("degrades to null on HTTP error", async () => {
		expect(
			await getUsTradeCalendar({
				fetchImpl: stubFor({}, 404),
				today: "2026-08-14",
			})
		).toBeNull();
	});
});
