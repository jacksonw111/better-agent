import { describe, expect, it } from "vitest";
import { listReports } from "./periodic-reports";

function jsonpResponse(list: unknown[]): Response {
	return new Response(`jsonp(${JSON.stringify({ data: { list } })})`);
}

describe("listReports", () => {
	it("keeps only the four full periodic reports and builds a proxied pdfUrl", async () => {
		const list = [
			{
				art_code: "AN202607081",
				notice_date: "2026-07-01 00:00:00",
				title_ch: "2026年半年度报告",
				columns: [{ column_name: "半年度报告全文" }],
			},
			{
				art_code: "AN202607082",
				notice_date: "2026-07-02 00:00:00",
				title_ch: "投资者关系活动记录表",
				columns: [{ column_name: "其他" }],
			},
		];
		let calls = 0;
		const fetchImpl = () => {
			calls++;
			return Promise.resolve(
				calls === 1 ? jsonpResponse(list) : jsonpResponse([])
			);
		};
		const reports = await listReports("600000.SH", 2, {
			fetchImpl: fetchImpl as typeof fetch,
			now: Date.parse("2026-07-08"),
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]?.reportType).toBe("h1");
		expect(reports[0]?.pdfUrl).toBe(
			`/pdf?url=${encodeURIComponent("https://pdf.dfcfw.com/pdf/H2_AN202607081_1.pdf")}`
		);
	});
});
