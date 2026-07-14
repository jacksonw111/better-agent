import { z } from "zod";

// FE-11 slice: finance_margin (margin-chart.tsx) and finance_divergence
// (divergence-card.tsx). Split out as its own file — same pattern as
// finance-schemas-fe6/7/8/9/10.ts — since finance-schemas.ts is at the
// project's 300-line-per-file cap.

export const MarginRowSchema = z.object({
	// Required discriminator: identifies this as a margin-trading row.
	date: z.string(),
	financingBalance: z.number().catch(0),
	financingBuy: z.number().catch(0),
	securitiesBalance: z.number().catch(0),
	securitiesVolume: z.number().catch(0),
	totalBalance: z.number().catch(0),
	financingBalanceRatio: z.number().catch(0),
});

export type MarginRowData = z.infer<typeof MarginRowSchema>;

const DIVERGENCE_SIGNALS = [
	"顶背离",
	"底背离",
	"多头共振",
	"空头共振",
	"中性",
	"数据不足",
] as const;

export const DivergenceSignalSchema = z
	.enum(DIVERGENCE_SIGNALS)
	.catch("数据不足");

export type DivergenceSignal = z.infer<typeof DivergenceSignalSchema>;

export const DivergenceSchema = z.object({
	// Required discriminator: identifies this as a price↔sentiment
	// divergence-signal result.
	ticker: z.string(),
	priceChange1d: z.number().catch(0),
	priceChange5d: z.number().catch(0),
	priceTrend: z.string().catch(""),
	buzzScore: z.number().catch(0),
	sentimentScore: z.number().catch(0),
	bullishPct: z.number().catch(0),
	bearishPct: z.number().catch(0),
	sentimentNet: z.number().catch(0),
	sentimentTrend: z.string().catch(""),
	signal: DivergenceSignalSchema,
	note: z.string().catch(""),
});

export type DivergenceData = z.infer<typeof DivergenceSchema>;
