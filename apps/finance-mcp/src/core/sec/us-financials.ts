// US annual statements + derived indicator series from SEC XBRL 10-K facts:
// the US counterpart of core/eastmoney/statements.ts / indicators.ts. Rows
// are fiscal-year (annual) only — quarterly XBRL data is too irregular
// (YTD cashflows, restated comparatives) for a reliable generic series.
import { normalizeStatement } from "../eastmoney/statements";
import type { StatementRow, StatementType } from "../types";
import type { AnnualFacts, AnnualPoint, ConceptSpec } from "./annual-facts";
import { getAnnualFacts } from "./annual-facts";
import type { SecFetchOpts } from "./edgar";

const DEFAULT_STATEMENT_PERIODS = 4;
const MAX_STATEMENT_PERIODS = 20;
const DEFAULT_INDICATOR_PERIODS = 8;
const MAX_INDICATOR_PERIODS = 40;
const PCT = 100;
const ROUND_SCALE = 100;

const REVENUE_TAGS = [
	"Revenues",
	"RevenueFromContractWithCustomerExcludingAssessedTax",
	"RevenueFromContractWithCustomerIncludingAssessedTax",
	"SalesRevenueNet",
];
const COST_TAGS = [
	"CostOfRevenue",
	"CostOfGoodsAndServicesSold",
	"CostOfGoodsSold",
];
const EQUITY_TAGS = [
	"StockholdersEquity",
	"StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
];
const EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"];

const INCOME_CONCEPTS: ConceptSpec[] = [
	{ key: "revenue", tags: REVENUE_TAGS },
	{ key: "operatingCost", tags: COST_TAGS },
	{ key: "grossProfit", tags: ["GrossProfit"] },
	{ key: "operatingProfit", tags: ["OperatingIncomeLoss"] },
	{ key: "netProfit", tags: ["NetIncomeLoss"] },
	{ key: "eps", tags: EPS_TAGS },
];
const BALANCE_CONCEPTS: ConceptSpec[] = [
	{ key: "totalAssets", tags: ["Assets"] },
	{ key: "totalLiabilities", tags: ["Liabilities"] },
	{ key: "totalEquity", tags: EQUITY_TAGS },
	{ key: "cash", tags: ["CashAndCashEquivalentsAtCarryingValue"] },
];
const CASHFLOW_CONCEPTS: ConceptSpec[] = [
	{
		key: "operatingCashflow",
		tags: [
			"NetCashProvidedByUsedInOperatingActivities",
			"NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
		],
	},
	{
		key: "investingCashflow",
		tags: [
			"NetCashProvidedByUsedInInvestingActivities",
			"NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
		],
	},
	{
		key: "financingCashflow",
		tags: [
			"NetCashProvidedByUsedInFinancingActivities",
			"NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
		],
	},
];
const CONCEPTS_BY_STATEMENT: Record<StatementType, ConceptSpec[]> = {
	income: INCOME_CONCEPTS,
	balance: BALANCE_CONCEPTS,
	cashflow: CASHFLOW_CONCEPTS,
};
const INDICATOR_CONCEPTS: ConceptSpec[] = [
	{ key: "revenue", tags: REVENUE_TAGS },
	{ key: "operatingCost", tags: COST_TAGS },
	{ key: "grossProfit", tags: ["GrossProfit"] },
	{ key: "netProfit", tags: ["NetIncomeLoss"] },
	{ key: "eps", tags: EPS_TAGS },
	{ key: "totalAssets", tags: ["Assets"] },
	{ key: "totalLiabilities", tags: ["Liabilities"] },
	{ key: "totalEquity", tags: EQUITY_TAGS },
];

export interface UsIndicatorRow {
	debtRatio: number | null;
	eps: number | null;
	grossMargin: number | null;
	netMargin: number | null;
	netProfit: number | null;
	netProfitYoy: number | null;
	reportDate: string;
	reportName: string;
	revenue: number | null;
	revenueYoy: number | null;
	roe: number | null;
}

function clampPeriods(periods: number, fallback: number, max: number): number {
	if (!Number.isFinite(periods) || periods <= 0) {
		return fallback;
	}
	return Math.min(Math.floor(periods), max);
}

function round2(value: number): number {
	return Math.round(value * ROUND_SCALE) / ROUND_SCALE;
}

function pctRatio(
	numerator: number | null,
	denominator: number | null
): number | null {
	if (numerator === null || denominator === null || denominator === 0) {
		return null;
	}
	return round2((numerator / denominator) * PCT);
}

function yoyPct(current: number | null, prior: number | null): number | null {
	if (current === null || prior === null || prior === 0) {
		return null;
	}
	return round2((current / prior - 1) * PCT);
}

function valueAt(
	series: AnnualPoint[] | undefined,
	end: string
): number | null {
	return series?.find((point) => point.end === end)?.val ?? null;
}

// Union of period-end dates across all series, ascending.
function collectEnds(facts: AnnualFacts): string[] {
	const ends = new Set<string>();
	for (const series of Object.values(facts.series)) {
		for (const point of series) {
			ends.add(point.end);
		}
	}
	return [...ends].sort((a, b) => a.localeCompare(b));
}

function buildStatementRow(
	facts: AnnualFacts,
	concepts: ConceptSpec[],
	end: string
): StatementRow {
	const row: StatementRow = { reportDate: end };
	for (const spec of concepts) {
		row[spec.key] = valueAt(facts.series[spec.key], end);
	}
	if (concepts === BALANCE_CONCEPTS) {
		row.debtRatio = pctRatio(
			valueAt(facts.series.totalLiabilities, end),
			valueAt(facts.series.totalAssets, end)
		);
	}
	return row;
}

export async function getUsStatements(
	ticker: string,
	statement: string,
	periods: number,
	opts: SecFetchOpts = {}
): Promise<StatementRow[]> {
	const concepts = CONCEPTS_BY_STATEMENT[normalizeStatement(statement)];
	const facts = await getAnnualFacts(ticker, concepts, opts);
	if (!facts) {
		return [];
	}
	const size = clampPeriods(
		periods,
		DEFAULT_STATEMENT_PERIODS,
		MAX_STATEMENT_PERIODS
	);
	return collectEnds(facts)
		.slice(-size)
		.reverse()
		.map((end) => buildStatementRow(facts, concepts, end));
}

const ISO_YEAR_LENGTH = 4;

function buildIndicatorRow(
	facts: AnnualFacts,
	end: string,
	priorEnd: string | undefined
): UsIndicatorRow {
	const { series } = facts;
	const revenue = valueAt(series.revenue, end);
	const netProfit = valueAt(series.netProfit, end);
	const grossProfit =
		valueAt(series.grossProfit, end) ??
		subtract(revenue, valueAt(series.operatingCost, end));
	const priorRevenue = priorEnd ? valueAt(series.revenue, priorEnd) : null;
	const priorProfit = priorEnd ? valueAt(series.netProfit, priorEnd) : null;
	return {
		reportDate: end,
		reportName: `FY${end.slice(0, ISO_YEAR_LENGTH)}`,
		eps: valueAt(series.eps, end),
		revenue,
		revenueYoy: yoyPct(revenue, priorRevenue),
		netProfit,
		netProfitYoy: yoyPct(netProfit, priorProfit),
		grossMargin: pctRatio(grossProfit, revenue),
		netMargin: pctRatio(netProfit, revenue),
		roe: pctRatio(netProfit, valueAt(series.totalEquity, end)),
		debtRatio: pctRatio(
			valueAt(series.totalLiabilities, end),
			valueAt(series.totalAssets, end)
		),
	};
}

function subtract(a: number | null, b: number | null): number | null {
	return a !== null && b !== null ? a - b : null;
}

export async function getUsIndicators(
	ticker: string,
	periods: number,
	opts: SecFetchOpts = {}
): Promise<UsIndicatorRow[]> {
	const facts = await getAnnualFacts(ticker, INDICATOR_CONCEPTS, opts);
	if (!facts) {
		return [];
	}
	const size = clampPeriods(
		periods,
		DEFAULT_INDICATOR_PERIODS,
		MAX_INDICATOR_PERIODS
	);
	const ends = collectEnds(facts);
	return ends
		.map((end, i) => buildIndicatorRow(facts, end, ends[i - 1]))
		.slice(-size)
		.reverse();
}
