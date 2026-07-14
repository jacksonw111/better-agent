import { beforeEach, describe, expect, it } from "vitest";
import { getInstitutionalHolders } from "./holders";
import { resetYahooAuthCache } from "./session";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";
const HOLDERS_OVERFLOW = 12;
const HOLDERS_CAP = 10;

const SUMMARY = {
	majorHoldersBreakdown: {
		insidersPercentHeld: { raw: 0.02 },
		institutionsPercentHeld: { raw: 0.61 },
		institutionsFloatPercentHeld: { raw: 0.62 },
		institutionsCount: { raw: 5834 },
	},
	institutionOwnership: {
		ownershipList: [
			{
				organization: "Vanguard Group Inc",
				position: { raw: 1_300_000_000 },
				value: { raw: 290_000_000_000 },
				pctHeld: { raw: 0.086 },
				reportDate: { raw: 1_735_603_200, fmt: "2024-12-31" },
			},
		],
	},
};

function stubFor(summary: unknown): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.startsWith("https://fc.yahoo.com")) {
			return Promise.resolve(
				new Response("", { headers: { "set-cookie": SET_COOKIE } })
			);
		}
		if (href.includes("/v1/test/getcrumb")) {
			return Promise.resolve(new Response("crumb-1"));
		}
		if (href.includes("/v10/finance/quoteSummary/")) {
			expect(href).toContain(
				"modules=institutionOwnership,majorHoldersBreakdown"
			);
			return Promise.resolve(
				Response.json({ quoteSummary: { result: [summary] } })
			);
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

beforeEach(() => {
	resetYahooAuthCache();
});

describe("getInstitutionalHolders: field extraction", () => {
	it("maps the breakdown overview and top holders", async () => {
		const holders = await getInstitutionalHolders("AAPL", {
			fetchImpl: stubFor(SUMMARY),
		});
		expect(holders?.overview).toEqual({
			insidersPct: 0.02,
			institutionsPct: 0.61,
			institutionsFloatPct: 0.62,
			institutionsCount: 5834,
		});
		expect(holders?.topHolders).toEqual([
			{
				name: "Vanguard Group Inc",
				shares: 1_300_000_000,
				value: 290_000_000_000,
				pctHeld: 0.086,
				reportDate: "2024-12-31",
			},
		]);
	});

	it("caps topHolders at 10 entries", async () => {
		const ownershipList = Array.from({ length: HOLDERS_OVERFLOW }, (_, i) => ({
			organization: `Fund ${i}`,
			position: { raw: i },
		}));
		const holders = await getInstitutionalHolders("AAPL", {
			fetchImpl: stubFor({ institutionOwnership: { ownershipList } }),
		});
		expect(holders?.topHolders).toHaveLength(HOLDERS_CAP);
		expect(holders?.topHolders[0]?.name).toBe("Fund 0");
	});
});

describe("getInstitutionalHolders: degradation", () => {
	it("returns null when the quoteSummary fetch fails", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await getInstitutionalHolders("AAPL", { fetchImpl })).toBeNull();
	});

	it("returns null overview fields when modules are missing", async () => {
		const holders = await getInstitutionalHolders("AAPL", {
			fetchImpl: stubFor({}),
		});
		expect(holders).toEqual({
			overview: {
				insidersPct: null,
				institutionsPct: null,
				institutionsFloatPct: null,
				institutionsCount: null,
			},
			topHolders: [],
		});
	});
});
