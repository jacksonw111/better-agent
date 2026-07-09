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
