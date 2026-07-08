import { describe, expect, it } from "vitest";
import { getMoneyFlow } from "./money-flow";

describe("getMoneyFlow", () => {
	it("normalizes the fixed 5-number kline CSV in order", async () => {
		const payload = {
			data: {
				klines: ["2026-07-08,39098074,-3424033,-35674041,-11642169,50740243"],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getMoneyFlow("600519.SH", 5, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			date: "2026-07-08",
			mainNet: 39_098_074,
			smallNet: -3_424_033,
			mediumNet: -35_674_041,
			largeNet: -11_642_169,
			superNet: 50_740_243,
		});
	});

	it("returns [] for a non-A-share symbol without fetching", async () => {
		let called = false;
		const fetchImpl = () => {
			called = true;
			return Promise.resolve(Response.json({ data: { klines: [] } }));
		};
		const rows = await getMoneyFlow("AAPL", 5, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
		expect(called).toBe(false);
	});

	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		const rows = await getMoneyFlow("600519.SH", 5, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});

	it("degrades to [] on malformed JSON", async () => {
		const fetchImpl = () => Promise.resolve(new Response("not json"));
		const rows = await getMoneyFlow("600519.SH", 5, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});
