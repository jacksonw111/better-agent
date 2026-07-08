import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { getCompanyProfile } from "./profile";

describe("getCompanyProfile normalization", () => {
	it("normalizes jbzl + fxxg", async () => {
		const payload = {
			jbzl: [
				{
					ORG_NAME: "贵州茅台酒股份有限公司",
					EM2016: "酿酒行业",
					INDUSTRYCSRC1: "酒、饮料和精制茶制造业",
					TRADE_MARKET: "上海证券交易所主板",
					CHAIRMAN: "张德芹",
					EMP_NUM: 32_320,
					REG_CAPITAL: 1_256_197_800,
					ORG_PROFILE: "公司主要从事茅台酒及系列酒的生产与销售。",
					BUSINESS_SCOPE: "茅台酒及系列产品的生产、销售。",
					ADDRESS: "贵州省仁怀市茅台镇",
				},
			],
			fxxg: [
				{
					LISTING_DATE: "2001-08-27 00:00:00",
					FOUND_DATE: "1999-11-20 00:00:00",
				},
			],
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const profile = await getCompanyProfile("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(profile).toMatchObject({
			name: "贵州茅台酒股份有限公司",
			industry: "酿酒行业",
			csrcIndustry: "酒、饮料和精制茶制造业",
			market: "上海证券交易所主板",
			chairman: "张德芹",
			employees: 32_320,
			regCapital: 1_256_197_800,
			profile: "公司主要从事茅台酒及系列酒的生产与销售。",
			businessScope: "茅台酒及系列产品的生产、销售。",
			address: "贵州省仁怀市茅台镇",
			listingDate: "2001-08-27",
			foundDate: "1999-11-20",
		});
	});
});

describe("getCompanyProfile edge cases", () => {
	it("is null-safe when jbzl/fxxg are missing", async () => {
		const fetchImpl = () => Promise.resolve(Response.json({}));
		const profile = await getCompanyProfile("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(profile).toBeNull();
	});

	it("degrades to null on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getCompanyProfile("600519.SH", {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toBeNull();
	});

	it("throws BadSymbolError for non-A symbols", async () => {
		await expect(getCompanyProfile("AAPL")).rejects.toThrow(BadSymbolError);
	});
});
