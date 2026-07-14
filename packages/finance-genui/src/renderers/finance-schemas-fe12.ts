import { z } from "zod";

// FE-12 slice: finance_sentiment_compare (sentiment-compare.tsx),
// finance_holder_count (holder-count-chart.tsx), finance_cn_hot
// (cn-hot-list.tsx). Split out as its own file — same pattern as
// finance-schemas-fe6/7/8/9/10/11.ts — since finance-schemas.ts is at the
// project's 300-line-per-file cap.

export const SentimentCompareSchema = z.object({
	// Required discriminator: identifies this as a sentiment-compare row.
	ticker: z.string(),
	name: z.string().catch(""),
	buzzScore: z.number().catch(0),
	trend: z.string().catch(""),
	mentions: z.number().catch(0),
	sentimentScore: z.number().catch(0),
	bullishPct: z.number().catch(0),
	bearishPct: z.number().catch(0),
});

export type SentimentCompareData = z.infer<typeof SentimentCompareSchema>;

export const HolderCountRowSchema = z.object({
	// Required discriminator: identifies this as a shareholder-count row.
	endDate: z.string(),
	totalHolders: z.number().nullable().catch(null),
	changeRatio: z.number().nullable().catch(null),
	avgFreeShares: z.number().nullable().catch(null),
	avgFreeSharesRatio: z.number().nullable().catch(null),
});

export type HolderCountRowData = z.infer<typeof HolderCountRowSchema>;

export const CnHotRowSchema = z.object({
	// Required discriminator: identifies this as an A股人气榜 (股吧热度排名) row.
	code: z.string(),
	rank: z.number().catch(0),
	name: z.string().catch(""),
	last: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	rankChange: z.number().nullable().catch(null),
});

export type CnHotRowData = z.infer<typeof CnHotRowSchema>;
