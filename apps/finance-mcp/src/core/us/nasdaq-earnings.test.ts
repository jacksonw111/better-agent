import { describe, expect, it } from "vitest";
import { usEarnings } from "./nasdaq-earnings";

describe("usEarnings", () => {
	it("normalizes Nasdaq rows", async () => {
		const payload = {
			data: {
				rows: [
					{
						symbol: "PEP",
						name: "PepsiCo",
						time: "time-pre-market",
						epsForecast: "$2.00",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const events = await usEarnings("2026-07-09", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events[0]).toMatchObject({
			market: "us",
			symbol: "PEP",
			name: "PepsiCo",
			date: "2026-07-09",
			session: "pre-market",
		});
	});

	it("returns [] when Nasdaq has no rows", async () => {
		const fetchImpl = () => Promise.resolve(Response.json({ data: null }));
		expect(
			await usEarnings("2026-07-09", { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});
});
