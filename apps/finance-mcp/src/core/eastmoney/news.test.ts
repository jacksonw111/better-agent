import { describe, expect, it } from "vitest";
import { getMarketNews, getStockNews } from "./news";

describe("getMarketNews", () => {
	it("maps fastNewsList rows to NewsItem", async () => {
		const payload = {
			data: {
				fastNewsList: [
					{
						code: "x",
						title: "t",
						summary: "s",
						showTime: "2026-07-08 23:07:50",
						stockList: ["90.BK0464"],
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const items = await getMarketNews(20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toEqual([
			{
				id: "x",
				title: "t",
				summary: "s",
				time: "2026-07-08 23:07:50",
				related: ["90.BK0464"],
			},
		]);
	});

	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		const items = await getMarketNews(20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toEqual([]);
	});

	it("degrades to [] on malformed JSON", async () => {
		const fetchImpl = () => Promise.resolve(new Response("not json"));
		const items = await getMarketNews(20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toEqual([]);
	});
});

describe("getStockNews mapping", () => {
	it("maps cmsArticleWebOld rows and strips HTML tags from title", async () => {
		const payload = {
			code: 0,
			result: {
				cmsArticleWebOld: [
					{
						date: "2026-07-07 14:21:00",
						title: "<em>浦发</em>银行",
						content: "c",
						mediaName: "证券日报",
						url: "http://example.com/a",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const items = await getStockNews("浦发银行", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toEqual([
			{
				date: "2026-07-07 14:21:00",
				title: "浦发银行",
				snippet: "c",
				source: "证券日报",
				url: "http://example.com/a",
			},
		]);
	});
});

describe("getStockNews jsonp fallback", () => {
	it("falls back to parseJsonp when the body is still JSONP-wrapped", async () => {
		const payload = {
			code: 0,
			result: {
				cmsArticleWebOld: [
					{
						date: "d",
						title: "t",
						content: "c",
						mediaName: "m",
						url: "u",
					},
				],
			},
		};
		const fetchImpl = () =>
			Promise.resolve(new Response(`jQuery123(${JSON.stringify(payload)})`));
		const items = await getStockNews("q", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.title).toBe("t");
	});
});

describe("getStockNews degrade paths", () => {
	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		const items = await getStockNews("q", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toEqual([]);
	});

	it("degrades to [] on malformed/unparseable body", async () => {
		const fetchImpl = () => Promise.resolve(new Response("<html>oops</html>"));
		const items = await getStockNews("q", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(items).toEqual([]);
	});
});
