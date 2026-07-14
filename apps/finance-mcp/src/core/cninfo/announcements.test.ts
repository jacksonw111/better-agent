import { describe, expect, it } from "vitest";
import { getAnnouncements } from "./announcements";

// 2024-07-14T16:00:00Z == 2024-07-15 00:00 UTC+8 — catches a UTC-vs-UTC+8
// date bug exactly at midnight.
const ANN_TIME_MS = 1_720_972_800_000;

const CNINFO_ROWS = {
	announcements: [
		{
			announcementTitle: "2024年年度报告",
			announcementTypeName: "年报",
			announcementTime: ANN_TIME_MS,
			announcementId: "1220123456",
			adjunctUrl: "finalpage/2024-07-15/1220123456.PDF",
		},
	],
};

type Handler = (url: string, init?: RequestInit) => Response | null;

function fetchImplFrom(handler: Handler): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const res = handler(String(url), init);
		if (!res) {
			throw new Error(`unexpected URL in test: ${String(url)}`);
		}
		return Promise.resolve(res);
	}) as typeof fetch;
}

describe("getAnnouncements: cninfo happy path", () => {
	it("POSTs the fallback orgId form and maps rows", async () => {
		const bodies: string[] = [];
		const fetchImpl = fetchImplFrom((url, init) => {
			if (!url.includes("cninfo.com.cn/new/hisAnnouncement/query")) {
				return null;
			}
			bodies.push(String(init?.body));
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				"Content-Type": "application/x-www-form-urlencoded",
				Referer: "https://www.cninfo.com.cn/new/disclosure",
				Origin: "https://www.cninfo.com.cn",
			});
			return Response.json(CNINFO_ROWS);
		});
		const rows = await getAnnouncements("600519", 10, "年报", { fetchImpl });
		const body = new URLSearchParams(bodies[0]);
		expect(body.get("stock")).toBe("600519,gssh0600519");
		expect(body.get("pageSize")).toBe("10");
		expect(body.get("searchkey")).toBe("年报");
		expect(rows).toEqual([
			{
				title: "2024年年度报告",
				type: "年报",
				date: "2024-07-15",
				url: "https://www.cninfo.com.cn/new/disclosure/detail?annoId=1220123456",
				pdf: "http://static.cninfo.com.cn/finalpage/2024-07-15/1220123456.PDF",
			},
		]);
	});
});

describe("getAnnouncements: orgId retry", () => {
	it("re-queries once with the real orgId when the guess yields zero rows", async () => {
		const stocks: string[] = [];
		const fetchImpl = fetchImplFrom((url, init) => {
			if (url.includes("hisAnnouncement/query")) {
				const stock = new URLSearchParams(String(init?.body)).get("stock");
				stocks.push(stock ?? "");
				return stock === "601318,9900002221"
					? Response.json(CNINFO_ROWS)
					: Response.json({ announcements: [] });
			}
			if (url.includes("szse_stock.json")) {
				return Response.json({
					stockList: [{ code: "601318", orgId: "9900002221" }],
				});
			}
			return null;
		});
		const rows = await getAnnouncements("601318", 20, "", { fetchImpl });
		expect(stocks).toEqual(["601318,gssh0601318", "601318,9900002221"]);
		expect(rows).toHaveLength(1);
	});
});

describe("getAnnouncements: eastmoney backup", () => {
	it("falls back to the np-anotice feed when cninfo fails", async () => {
		const fetchImpl = fetchImplFrom((url) => {
			if (url.includes("cninfo.com.cn")) {
				return new Response("blocked", { status: 404 });
			}
			if (url.includes("np-anotice-stock.eastmoney.com/api/security/ann")) {
				expect(url).toContain("stock_list=600519");
				expect(url).toContain("page_size=20");
				return Response.json({
					data: {
						list: [
							{
								title: "关于回购的公告",
								notice_date: "2026-07-10 00:00:00",
								art_code: "AN2026071012345",
							},
						],
					},
				});
			}
			return null;
		});
		const rows = await getAnnouncements("600519", 20, "", { fetchImpl });
		expect(rows).toEqual([
			{
				title: "关于回购的公告",
				type: "",
				date: "2026-07-10",
				url: "",
				pdf: "https://pdf.dfcfw.com/pdf/H2_AN2026071012345_1.pdf",
			},
		]);
	});

	it("degrades to [] when every source fails", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("x", { status: 404 }))) as typeof fetch;
		expect(await getAnnouncements("600519", 20, "", { fetchImpl })).toEqual([]);
	});
});
