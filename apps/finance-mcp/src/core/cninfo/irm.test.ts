import { describe, expect, it } from "vitest";
import { formatUtc8Minute, getInvestorQa } from "./irm";

const ASK_MS = Date.UTC(2026, 4, 9, 2, 30); // 2026-05-09 10:30 in UTC+8

const QA_PAYLOAD = {
	rows: [
		{
			stockCode: "002594",
			companyShortName: "比亚迪",
			mainContent: "公司固态电池进展如何？",
			attachedContent: "相关技术正在研发中。",
			attachedAuthor: "董秘",
			pubDate: ASK_MS,
		},
		{ stockCode: "002594", mainContent: "何时分红？", pubDate: null },
	],
};

function fetchImplFor(): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		if (href.includes("/newircs/index/queryKeyboardInfo")) {
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				"Content-Type": "application/x-www-form-urlencoded",
			});
			expect(String(init?.body)).toBe("keyWord=002594");
			return Promise.resolve(
				Response.json({ data: [{ secid: "gshk0002594" }] })
			);
		}
		if (href.includes("/newircs/company/question")) {
			expect(init?.method).toBe("POST");
			// The endpoint 400s if params land in the body: query string only.
			expect(init?.body).toBeUndefined();
			const query = new URL(href).searchParams;
			expect(query.get("_t")).toBe("1");
			expect(query.get("stockcode")).toBe("002594");
			expect(query.get("orgId")).toBe("gshk0002594");
			expect(query.get("pageSize")).toBe("10");
			expect(query.get("pageNum")).toBe("1");
			expect(query.get("keyWord")).toBe("");
			expect(query.get("startDay")).toBe("");
			expect(query.get("endDay")).toBe("");
			return Promise.resolve(Response.json(QA_PAYLOAD));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

describe("formatUtc8Minute: pure UTC+8 formatting", () => {
	it("formats millisecond epochs as YYYY-MM-DD HH:mm in UTC+8", () => {
		expect(formatUtc8Minute(ASK_MS)).toBe("2026-05-09 10:30");
		// Crosses the day boundary when shifting UTC -> UTC+8.
		expect(formatUtc8Minute(Date.UTC(2026, 0, 1, 20, 5))).toBe(
			"2026-01-02 04:05"
		);
	});
});

describe("getInvestorQa: two-step happy path", () => {
	it("resolves orgId then maps Q&A rows (unanswered -> null)", async () => {
		const rows = await getInvestorQa("002594", 10, {
			fetchImpl: fetchImplFor(),
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			code: "002594",
			company: "比亚迪",
			question: "公司固态电池进展如何？",
			answer: "相关技术正在研发中。",
			answerer: "董秘",
			askTime: "2026-05-09 10:30",
		});
		expect(rows[1]).toMatchObject({ answer: null, answerer: "", askTime: "" });
	});
});

describe("getInvestorQa: degradation", () => {
	it("returns [] when the keyboard lookup finds no org", async () => {
		const fetchImpl = (() =>
			Promise.resolve(Response.json({ data: [] }))) as typeof fetch;
		expect(await getInvestorQa("002594", 10, { fetchImpl })).toEqual([]);
	});

	it("returns [] when step 1 fails with a non-OK status", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getInvestorQa("002594", 10, { fetchImpl })).toEqual([]);
	});

	it("returns [] when step 2 throws", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			if (String(url).includes("queryKeyboardInfo")) {
				return Promise.resolve(Response.json({ data: [{ secid: "x" }] }));
			}
			return Promise.reject(new Error("network down"));
		}) as typeof fetch;
		expect(await getInvestorQa("002594", 10, { fetchImpl })).toEqual([]);
	});
});
