import { describe, expect, it } from "vitest";
import { aShareEarnings, earningsCalendar } from "./earnings";

describe("aShareEarnings", () => {
	it("normalizes RPT_PUBLIC_BS_APPOIN rows", async () => {
		const payload = {
			result: {
				data: [
					{
						SECURITY_CODE: "600000",
						SECURITY_NAME_ABBR: "浦发银行",
						APPOINT_PUBLISH_DATE: "2026-08-28 00:00:00",
						ACTUAL_PUBLISH_DATE: null,
						IS_PUBLISH: "否",
						REPORT_TYPE_NAME: "2026年 半年报",
					},
				],
			},
			success: true,
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const events = await aShareEarnings("2026-06-30", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(events[0]).toMatchObject({
			market: "a",
			symbol: "600000",
			name: "浦发银行",
			date: "2026-08-28",
			isPublished: false,
			reportType: "2026年 半年报",
		});
	});
});

describe("earningsCalendar dispatch", () => {
	it("HK is best-effort and returns []", async () => {
		expect(await earningsCalendar("hk", "2026-06-30")).toEqual([]);
	});
});
