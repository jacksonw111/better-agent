import { fetchWithRetry } from "../http";
import type { CompanyProfile } from "../types";
import { secucode } from "./secucode";

const PROFILE_URL =
	"https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax";
const DATE_LENGTH = 10;

interface Jbzl {
	ADDRESS?: string | null;
	BUSINESS_SCOPE?: string | null;
	CHAIRMAN?: string | null;
	EM2016?: string | null;
	EMP_NUM?: number | null;
	INDUSTRYCSRC1?: string | null;
	ORG_NAME?: string | null;
	ORG_PROFILE?: string | null;
	REG_CAPITAL?: number | null;
	TRADE_MARKET?: string | null;
}

interface Fxxg {
	FOUND_DATE?: string | null;
	LISTING_DATE?: string | null;
}

function toDate(value: string | null | undefined): string | null {
	return value ? value.slice(0, DATE_LENGTH) : null;
}

// See valuation.ts's orNull comment: routing every `?? null` through this
// helper keeps toProfile itself branch-free (complexity 1) under the cap.
function orNull<T>(value: T | null | undefined): T | null {
	return value ?? null;
}

function toProfile(jbzl: Jbzl, fxxg: Fxxg): CompanyProfile {
	return {
		name: orNull(jbzl.ORG_NAME),
		industry: orNull(jbzl.EM2016),
		csrcIndustry: orNull(jbzl.INDUSTRYCSRC1),
		market: orNull(jbzl.TRADE_MARKET),
		chairman: orNull(jbzl.CHAIRMAN),
		employees: orNull(jbzl.EMP_NUM),
		regCapital: orNull(jbzl.REG_CAPITAL),
		profile: orNull(jbzl.ORG_PROFILE),
		businessScope: orNull(jbzl.BUSINESS_SCOPE),
		address: orNull(jbzl.ADDRESS),
		listingDate: toDate(fxxg.LISTING_DATE),
		foundDate: toDate(fxxg.FOUND_DATE),
	};
}

export async function getCompanyProfile(
	symbol: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CompanyProfile | null> {
	const { emCode } = secucode(symbol);
	const url = `${PROFILE_URL}?code=${emCode}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as {
			jbzl?: Jbzl[] | null;
			fxxg?: Fxxg[] | null;
		};
		const jbzl = json.jbzl?.[0];
		if (!jbzl) {
			return null;
		}
		return toProfile(jbzl, json.fxxg?.[0] ?? {});
	} catch {
		return null;
	}
}
