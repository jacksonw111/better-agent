import { describe, expect, it } from "vitest";
import { economicCalendar, NotConfiguredError } from "./economic";

describe("economicCalendar", () => {
	it("throws NotConfiguredError without a key", async () => {
		await expect(
			economicCalendar("2026-07-01", "2026-07-15", "", undefined)
		).rejects.toBeInstanceOf(NotConfiguredError);
	});

	it("normalizes + filters by country", async () => {
		const payload = {
			economicCalendar: [
				{
					country: "US",
					event: "CPI YoY",
					time: "2026-07-10 12:30:00",
					actual: null,
					estimate: "3.1%",
					prev: "3.0%",
					impact: "high",
				},
				{
					country: "CN",
					event: "PPI YoY",
					time: "2026-07-09 01:30:00",
					actual: null,
					estimate: "-1.0%",
					prev: "-1.2%",
					impact: "medium",
				},
			],
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const us = await economicCalendar("2026-07-01", "2026-07-15", "KEY", "US", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(us).toHaveLength(1);
		expect(us[0]).toMatchObject({
			country: "US",
			event: "CPI YoY",
			date: "2026-07-10",
			estimate: "3.1%",
			prior: "3.0%",
			impact: "high",
		});
	});
});
