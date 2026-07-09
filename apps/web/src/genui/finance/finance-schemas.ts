import { z } from "zod";

// Resilient Zod schemas for the finance-mcp tool results, mirroring the
// pattern in ../x-result-schemas.ts: only the field(s) that identify the
// shape are required, every display field has a `.catch` default or is
// `.nullable()` — a stray null must never blank the whole render.
//
// This is the FE-1 slice only (finance_index_quote / finance_commodity).
// Later batches (finance_quote, finance_kline, finance_technical, …) extend
// this file with additional schema + inferred-type export pairs — keep each
// block self-contained so it stays easy to append to.

export const IndexQuoteSchema = z.object({
	// Required discriminator: identifies this as an index quote.
	code: z.string(),
	region: z.string().catch(""),
	name: z.string().catch(""),
	last: z.number().nullable().catch(null),
	prevClose: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	high: z.number().nullable().catch(null),
	low: z.number().nullable().catch(null),
});

export type IndexQuoteData = z.infer<typeof IndexQuoteSchema>;

export const CommodityQuoteSchema = z.object({
	// Required discriminator: identifies this as a commodity quote.
	key: z.string(),
	name: z.string().catch(""),
	last: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	high: z.number().nullable().catch(null),
	low: z.number().nullable().catch(null),
	prevClose: z.number().nullable().catch(null),
	time: z.string().catch(""),
});

export type CommodityQuoteData = z.infer<typeof CommodityQuoteSchema>;

// FE-2 slice: finance_quote / finance_technical.

const DepthLevelSchema = z.object({
	price: z.number().nullable().catch(null),
	volume: z.number().nullable().catch(null),
});

export type DepthLevelData = z.infer<typeof DepthLevelSchema>;

export const QuoteSchema = z.object({
	// Required discriminator: identifies this as a single-symbol quote.
	symbol: z.string(),
	market: z.string().catch(""),
	name: z.string().catch(""),
	last: z.number().nullable().catch(null),
	prevClose: z.number().nullable().catch(null),
	open: z.number().nullable().catch(null),
	high: z.number().nullable().catch(null),
	low: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	volume: z.number().nullable().catch(null),
	time: z.string().catch(""),
	bids: z.array(DepthLevelSchema).catch([]),
	asks: z.array(DepthLevelSchema).catch([]),
});

export type QuoteData = z.infer<typeof QuoteSchema>;

const MacdSchema = z
	.object({
		dif: z.number().nullable().catch(null),
		dea: z.number().nullable().catch(null),
		macd: z.number().nullable().catch(null),
	})
	.nullable()
	.catch(null);

const KdjSchema = z
	.object({
		k: z.number().nullable().catch(null),
		d: z.number().nullable().catch(null),
		j: z.number().nullable().catch(null),
	})
	.nullable()
	.catch(null);

const BollSchema = z
	.object({
		upper: z.number().nullable().catch(null),
		mid: z.number().nullable().catch(null),
		lower: z.number().nullable().catch(null),
	})
	.nullable()
	.catch(null);

export const TechnicalSchema = z.object({
	// Required discriminator: identifies this as a technical-indicator panel.
	symbol: z.string(),
	period: z.string().catch(""),
	asOf: z.string().catch(""),
	close: z.number().nullable().catch(null),
	ma5: z.number().nullable().catch(null),
	ma10: z.number().nullable().catch(null),
	ma20: z.number().nullable().catch(null),
	ma60: z.number().nullable().catch(null),
	ema12: z.number().nullable().catch(null),
	ema26: z.number().nullable().catch(null),
	macd: MacdSchema,
	rsi14: z.number().nullable().catch(null),
	kdj: KdjSchema,
	boll: BollSchema,
});

export type TechnicalData = z.infer<typeof TechnicalSchema>;

// finance_kline slice: one candle per row, result is an array (see listEntry
// in finance-renderers.tsx). `time` is the required discriminator; every
// numeric field falls back to 0 so a stray malformed field degrades that one
// candle to a flat/zero-volume bar instead of dropping the whole series.

export const CandleSchema = z.object({
	// Required discriminator: identifies this as a single kline candle.
	time: z.string(),
	open: z.number().catch(0),
	high: z.number().catch(0),
	low: z.number().catch(0),
	close: z.number().catch(0),
	volume: z.number().catch(0),
});

export type CandleData = z.infer<typeof CandleSchema>;

// FE-2 fundamentals slice: finance_key_metrics / finance_company_profile /
// finance_financial_indicators / finance_financial_statements. Mirrors
// KeyMetrics / CompanyProfile / IndicatorRow / StatementRow in
// apps/finance-mcp/src/core/types.ts.

export const KeyMetricsSchema = z.object({
	// Required discriminator: identifies this as a valuation snapshot.
	symbol: z.string(),
	tradeDate: z.string().nullable().catch(null),
	close: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	marketCap: z.number().nullable().catch(null),
	floatMarketCap: z.number().nullable().catch(null),
	totalShares: z.number().nullable().catch(null),
	floatShares: z.number().nullable().catch(null),
	peTtm: z.number().nullable().catch(null),
	peStatic: z.number().nullable().catch(null),
	pb: z.number().nullable().catch(null),
	ps: z.number().nullable().catch(null),
	pcf: z.number().nullable().catch(null),
	peg: z.number().nullable().catch(null),
});

export type KeyMetricsData = z.infer<typeof KeyMetricsSchema>;

export const CompanyProfileSchema = z.object({
	// Required discriminator: every other CompanyProfile field is nullable, so
	// `name` is the pragmatic pick — EastMoney's F10 payload always carries an
	// org name whenever a profile exists at all (see getCompanyProfile, which
	// returns null upstream when the raw `jbzl` block is entirely absent).
	name: z.string(),
	industry: z.string().nullable().catch(null),
	csrcIndustry: z.string().nullable().catch(null),
	market: z.string().nullable().catch(null),
	chairman: z.string().nullable().catch(null),
	employees: z.number().nullable().catch(null),
	regCapital: z.number().nullable().catch(null),
	profile: z.string().nullable().catch(null),
	businessScope: z.string().nullable().catch(null),
	address: z.string().nullable().catch(null),
	listingDate: z.string().nullable().catch(null),
	foundDate: z.string().nullable().catch(null),
});

export type CompanyProfileData = z.infer<typeof CompanyProfileSchema>;

export const IndicatorRowSchema = z.object({
	// Required discriminator: identifies this as a financial-indicator period.
	reportDate: z.string(),
	reportName: z.string().nullable().catch(null),
	eps: z.number().nullable().catch(null),
	bps: z.number().nullable().catch(null),
	revenue: z.number().nullable().catch(null),
	revenueYoy: z.number().nullable().catch(null),
	netProfit: z.number().nullable().catch(null),
	netProfitYoy: z.number().nullable().catch(null),
	grossMargin: z.number().nullable().catch(null),
	netMargin: z.number().nullable().catch(null),
	roe: z.number().nullable().catch(null),
	roeDeducted: z.number().nullable().catch(null),
	debtRatio: z.number().nullable().catch(null),
	opCashPerShare: z.number().nullable().catch(null),
});

export type IndicatorRowData = z.infer<typeof IndicatorRowSchema>;

// StatementRow's numeric fields vary by statement=income|balance|cashflow (see
// StatementRow's index signature in types.ts) — a given row only ever carries
// the subset for its own statement type, so every field here is independently
// nullable rather than required; `reportDate` alone discriminates the shape.
export const StatementRowSchema = z.object({
	reportDate: z.string(),
	// income
	revenue: z.number().nullable().catch(null),
	operatingCost: z.number().nullable().catch(null),
	operatingProfit: z.number().nullable().catch(null),
	totalProfit: z.number().nullable().catch(null),
	netProfit: z.number().nullable().catch(null),
	netProfitDeducted: z.number().nullable().catch(null),
	// balance
	totalAssets: z.number().nullable().catch(null),
	totalLiabilities: z.number().nullable().catch(null),
	totalEquity: z.number().nullable().catch(null),
	cash: z.number().nullable().catch(null),
	debtRatio: z.number().nullable().catch(null),
	// cashflow
	operatingCashflow: z.number().nullable().catch(null),
	investingCashflow: z.number().nullable().catch(null),
	financingCashflow: z.number().nullable().catch(null),
	netCashChange: z.number().nullable().catch(null),
});

export type StatementRowData = z.infer<typeof StatementRowSchema>;
