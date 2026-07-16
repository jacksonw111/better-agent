import { describe, expect, it } from "vitest";
import {
	getTradeCalendar,
	parseTradeCalendar,
	shanghaiToday,
} from "./trade-calendar";

// Tencent fqkline shape: data[code].day = [[date, open, close, high, low, vol]].
function klineJson(dates: string[]): unknown {
	return {
		data: {
			sh000001: {
				day: dates.map((d) => [d, "1", "2", "3", "0.5", "100"]),
			},
		},
	};
}

describe("shanghaiToday", () => {
	it("formats a fixed instant as the Asia/Shanghai ISO date", () => {
		// 2026-07-14T20:00:00Z = 2026-07-15 04:00 Shanghai (UTC+8).
		expect(shanghaiToday(new Date("2026-07-14T20:00:00Z"))).toBe("2026-07-15");
	});
});

describe("parseTradeCalendar", () => {
	it("takes the last bar as lastTradeDate and flags today open", () => {
		const cal = parseTradeCalendar(
			klineJson(["2026-07-13", "2026-07-14", "2026-07-15"]),
			"2026-07-15"
		);
		expect(cal).toEqual({
			lastTradeDate: "2026-07-15",
			isTodayTradingDay: true,
			tradeDays: ["2026-07-13", "2026-07-14", "2026-07-15"],
		});
	});

	it("flags today closed when the latest bar predates today", () => {
		const cal = parseTradeCalendar(
			klineJson(["2026-07-10", "2026-07-11"]),
			"2026-07-12"
		);
		expect(cal?.isTodayTradingDay).toBe(false);
		expect(cal?.lastTradeDate).toBe("2026-07-11");
	});

	it("returns null when the series is empty", () => {
		expect(parseTradeCalendar({ data: {} }, "2026-07-15")).toBeNull();
	});
});

describe("getTradeCalendar", () => {
	it("requests the sh000001 daily kline and injects today", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request) => {
			seen = String(url);
			return Promise.resolve(Response.json(klineJson(["2026-07-14"])));
		}) as typeof fetch;
		const cal = await getTradeCalendar({ fetchImpl, today: "2026-07-14" });
		expect(seen).toContain("sh000001,day");
		expect(cal).toMatchObject({
			lastTradeDate: "2026-07-14",
			isTodayTradingDay: true,
		});
	});

	it("degrades to null on HTTP 500", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getTradeCalendar({ fetchImpl })).toBeNull();
	});

	it("degrades to null on invalid JSON", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("<html>"))) as typeof fetch;
		expect(await getTradeCalendar({ fetchImpl })).toBeNull();
	});
});
