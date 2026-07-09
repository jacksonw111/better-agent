import { z } from "zod";

// FE-9 slice: finance_prediction_markets (prediction-markets.tsx). Mirrors a
// Polymarket-shaped market: { id, question, slug, endDate, volumeUsd,
// liquidityUsd, outcomes: [{name, probability, livePrice}] } (probability is
// 0..1; livePrice flags an outcome whose price streams from a live feed
// rather than a periodic snapshot). Split out as its own file — same pattern
// as finance-schemas-fe6/7/8.ts — since finance-schemas.ts is at the
// project's 300-line-per-file cap.

const PredictionOutcomeSchema = z.object({
	name: z.string().catch(""),
	probability: z.number().catch(0),
	livePrice: z.boolean().catch(false),
});

export type PredictionOutcomeData = z.infer<typeof PredictionOutcomeSchema>;

export const PredictionMarketSchema = z.object({
	// Required discriminator: identifies this as a prediction-market row.
	question: z.string(),
	id: z.string().catch(""),
	slug: z.string().catch(""),
	endDate: z.string().catch(""),
	volumeUsd: z.number().catch(0),
	liquidityUsd: z.number().catch(0),
	outcomes: z.array(PredictionOutcomeSchema).catch([]),
});

export type PredictionMarketData = z.infer<typeof PredictionMarketSchema>;
