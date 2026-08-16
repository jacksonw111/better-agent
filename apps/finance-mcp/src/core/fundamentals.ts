// Market routing for the four fundamentals tools: A-share → EastMoney,
// US → Yahoo (key metrics / profile) + SEC XBRL (statements / indicators).
// HK has no fundamentals source wired up and fails fast with a clear message.

import { getFinancialIndicators as aShareIndicators } from "./eastmoney/indicators";
import { getCompanyProfile as aShareProfile } from "./eastmoney/profile";
import { getStatements as aShareStatements } from "./eastmoney/statements";
import { getKeyMetrics as aShareKeyMetrics } from "./eastmoney/valuation";
import type { UsIndicatorRow } from "./sec/us-financials";
import { getUsIndicators, getUsStatements } from "./sec/us-financials";
import { BadSymbolError, parseSymbol } from "./symbol";
import type {
	CompanyProfile,
	IndicatorRow,
	KeyMetrics,
	StatementRow,
} from "./types";
import type { UsCompanyProfile, UsKeyMetrics } from "./yahoo/fundamentals";
import { getUsKeyMetrics, getUsProfile } from "./yahoo/fundamentals";

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

const HK_MESSAGE =
	"fundamentals cover A-share and US symbols only, e.g. 600519.SH or AAPL";

// Returns the bare US ticker, null for A-share, and throws for HK.
function usTicker(symbol: string): string | null {
	const { market, code } = parseSymbol(symbol);
	if (market === "hk") {
		throw new BadSymbolError(HK_MESSAGE);
	}
	return market === "us" ? code : null;
}

export function getKeyMetrics(
	symbol: string,
	opts: FetchOpts = {}
): Promise<KeyMetrics | UsKeyMetrics | null> {
	const us = usTicker(symbol);
	return us ? getUsKeyMetrics(us, opts) : aShareKeyMetrics(symbol, opts);
}

export function getCompanyProfile(
	symbol: string,
	opts: FetchOpts = {}
): Promise<CompanyProfile | UsCompanyProfile | null> {
	const us = usTicker(symbol);
	return us ? getUsProfile(us, opts) : aShareProfile(symbol, opts);
}

export function getStatements(
	symbol: string,
	statement: string,
	periods: number,
	opts: FetchOpts = {}
): Promise<StatementRow[]> {
	const us = usTicker(symbol);
	return us
		? getUsStatements(us, statement, periods, opts)
		: aShareStatements(symbol, statement, periods, opts);
}

export function getFinancialIndicators(
	symbol: string,
	periods: number,
	opts: FetchOpts = {}
): Promise<IndicatorRow[] | UsIndicatorRow[]> {
	const us = usTicker(symbol);
	return us
		? getUsIndicators(us, periods, opts)
		: aShareIndicators(symbol, periods, opts);
}
