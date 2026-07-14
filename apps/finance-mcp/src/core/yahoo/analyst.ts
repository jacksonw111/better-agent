// Analyst expectations via Yahoo quoteSummary: EPS estimate trend, buy/sell
// rating trend, and the upgrade/downgrade history (capped at 20 entries).
import { rawNum, yahooQuoteSummary } from "./session";

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface EpsTrendRow {
	endDate: string;
	epsEstimate: number | null;
	epsHigh: number | null;
	epsLow: number | null;
	numAnalysts: number | null;
	period: string;
	revenueEstimate: number | null;
}

export interface RatingTrendRow {
	buy: number | null;
	hold: number | null;
	period: string;
	sell: number | null;
	strongBuy: number | null;
	strongSell: number | null;
}

export interface UpgradeDowngradeRow {
	action: string;
	date: string;
	firm: string;
	fromGrade: string;
	toGrade: string;
}

export interface AnalystRatings {
	epsTrend: EpsTrendRow[];
	ratingTrend: RatingTrendRow[];
	upgradeDowngrade: UpgradeDowngradeRow[];
}

const QUOTE_SUMMARY_MODULES = [
	"earningsTrend",
	"recommendationTrend",
	"upgradeDowngradeHistory",
];
const UPGRADE_DOWNGRADE_CAP = 20;
const MS_PER_SECOND = 1000;
const ISO_DATE_LENGTH = 10;

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => asRecord(entry));
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function toEpsTrendRow(trend: Record<string, unknown>): EpsTrendRow {
	const earnings = asRecord(trend.earningsEstimate);
	const revenue = asRecord(trend.revenueEstimate);
	return {
		period: asString(trend.period),
		endDate: asString(trend.endDate),
		epsEstimate: rawNum(earnings.avg),
		epsHigh: rawNum(earnings.high),
		epsLow: rawNum(earnings.low),
		revenueEstimate: rawNum(revenue.avg),
		numAnalysts: rawNum(earnings.numberOfAnalysts),
	};
}

function toRatingTrendRow(trend: Record<string, unknown>): RatingTrendRow {
	return {
		period: asString(trend.period),
		strongBuy: rawNum(trend.strongBuy),
		buy: rawNum(trend.buy),
		hold: rawNum(trend.hold),
		sell: rawNum(trend.sell),
		strongSell: rawNum(trend.strongSell),
	};
}

// epochGradeDate is Unix seconds — rendered as a UTC "YYYY-MM-DD".
function epochToDate(value: unknown): string {
	const seconds = rawNum(value);
	if (seconds === null) {
		return "";
	}
	return new Date(seconds * MS_PER_SECOND)
		.toISOString()
		.slice(0, ISO_DATE_LENGTH);
}

function toUpgradeRow(entry: Record<string, unknown>): UpgradeDowngradeRow {
	return {
		date: epochToDate(entry.epochGradeDate),
		firm: asString(entry.firm),
		toGrade: asString(entry.toGrade),
		fromGrade: asString(entry.fromGrade),
		action: asString(entry.action),
	};
}

export async function getAnalystRatings(
	symbol: string,
	opts: FetchOpts = {}
): Promise<AnalystRatings | null> {
	const summary = await yahooQuoteSummary(symbol, QUOTE_SUMMARY_MODULES, opts);
	if (!summary) {
		return null;
	}
	const epsTrends = asRecords(asRecord(summary.earningsTrend).trend);
	const ratingTrends = asRecords(asRecord(summary.recommendationTrend).trend);
	const history = asRecords(
		asRecord(summary.upgradeDowngradeHistory).history
	).slice(0, UPGRADE_DOWNGRADE_CAP);
	return {
		epsTrend: epsTrends.map(toEpsTrendRow),
		ratingTrend: ratingTrends.map(toRatingTrendRow),
		upgradeDowngrade: history.map(toUpgradeRow),
	};
}
