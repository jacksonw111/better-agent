import { z } from "zod";

// FE-8 slice (final batch): finance_news / finance_stock_news (news-list.tsx),
// finance_research (research-list.tsx), finance_earnings_forecast
// (forecast-table.tsx), finance_list_reports (reports-list.tsx), and
// finance_search (search-list.tsx). Mirrors NewsItem / StockNewsItem /
// ResearchReport / ForecastRow / Report / StockHit in
// apps/finance-mcp/src/core/types.ts. Split out of finance-schemas.ts (which
// is at the project's 300-line-per-file cap) — same pattern as
// finance-schemas-fe6.ts / finance-schemas-fe7.ts.

// ---- finance_news / finance_stock_news --------------------------------
// Two distinct array results rendered by the same component (news-list.tsx),
// which tells them apart by the required discriminator each schema pins:
// `id` for the 7x24 flash-news feed, `url` for a stock/keyword news search.

export const NewsItemSchema = z.object({
	// Required discriminator: identifies this as a finance_news flash item.
	id: z.string(),
	title: z.string().catch(""),
	summary: z.string().catch(""),
	time: z.string().catch(""),
	related: z.array(z.string()).catch([]),
});

export type NewsItemData = z.infer<typeof NewsItemSchema>;

export const StockNewsItemSchema = z.object({
	// Required discriminator: identifies this as a finance_stock_news article.
	url: z.string(),
	title: z.string().catch(""),
	snippet: z.string().catch(""),
	date: z.string().catch(""),
	source: z.string().catch(""),
});

export type StockNewsItemData = z.infer<typeof StockNewsItemSchema>;

// ---- finance_research ---------------------------------------------------

export const ResearchReportSchema = z.object({
	// Required discriminator: identifies this as a research-report row.
	date: z.string(),
	org: z.string().catch(""),
	title: z.string().catch(""),
	epsY0: z.number().nullable().catch(null),
	epsY1: z.number().nullable().catch(null),
	epsY2: z.number().nullable().catch(null),
	peY0: z.number().nullable().catch(null),
	peY1: z.number().nullable().catch(null),
	peY2: z.number().nullable().catch(null),
	pdfUrl: z.string().catch(""),
});

export type ResearchReportData = z.infer<typeof ResearchReportSchema>;

// ---- finance_earnings_forecast ------------------------------------------

export const ForecastRowSchema = z.object({
	// Required discriminator: identifies this as a consensus-forecast row.
	year: z.string(),
	eps: z.number().nullable().catch(null),
	pe: z.number().nullable().catch(null),
	// Optional in ForecastRow — absent entirely for some symbols, not just
	// null, so `.catch(null)` (fires on both missing and malformed) covers it.
	revenue: z.number().nullable().catch(null),
});

export type ForecastRowData = z.infer<typeof ForecastRowSchema>;

// ---- finance_list_reports -------------------------------------------------

export const ReportSchema = z.object({
	// Required discriminator: EastMoney's article code, unique per report.
	artCode: z.string(),
	title: z.string().catch(""),
	reportType: z.string().catch(""),
	fiscalPeriod: z.string().catch(""),
	noticeDate: z.string().catch(""),
	pdfUrl: z.string().catch(""),
});

export type ReportData = z.infer<typeof ReportSchema>;

// ---- finance_search -------------------------------------------------------

export const StockHitSchema = z.object({
	// Required discriminator: identifies this as a stock-search hit.
	code: z.string(),
	name: z.string().catch(""),
	exchange: z.string().catch(""),
	market: z.string().catch(""),
});

export type StockHitData = z.infer<typeof StockHitSchema>;
