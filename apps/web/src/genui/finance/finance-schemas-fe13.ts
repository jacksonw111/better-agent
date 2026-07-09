import { z } from "zod";

// FE-13 slice: finance_earnings_preannounce (preannounce-list.tsx),
// finance_lockup (lockup-table.tsx), finance_convertible_bonds
// (convertible-bonds-table.tsx), finance_ipo (ipo-table.tsx). Mirrors
// PreannounceRow / LockupRow / ConvertibleBondRow / IpoRow in
// apps/finance-mcp/src/core/types-data.ts. Split out into its own file —
// same pattern as finance-schemas-fe6.ts / -fe7.ts / -fe8.ts (finance-schemas.ts
// is at the project's 300-line-per-file cap).

// ---- finance_earnings_preannounce ---------------------------------------

export const PreannounceRowSchema = z.object({
	// Required discriminator: identifies this as a preannouncement row.
	noticeDate: z.string(),
	reportDate: z.string().catch(""),
	code: z.string().catch(""),
	name: z.string().catch(""),
	type: z.string().catch(""),
	changeLower: z.number().nullable().catch(null),
	changeUpper: z.number().nullable().catch(null),
	content: z.string().catch(""),
	reason: z.string().catch(""),
});

export type PreannounceRowData = z.infer<typeof PreannounceRowSchema>;

// ---- finance_lockup -------------------------------------------------------

export const LockupRowSchema = z.object({
	// Required discriminator: identifies this as a lockup-expiry row.
	freeDate: z.string(),
	code: z.string().catch(""),
	name: z.string().catch(""),
	freeShares: z.number().nullable().catch(null),
	freeRatio: z.number().nullable().catch(null),
	liftMarketCap: z.number().nullable().catch(null),
	type: z.string().catch(""),
});

export type LockupRowData = z.infer<typeof LockupRowSchema>;

// ---- finance_convertible_bonds --------------------------------------------

export const ConvertibleBondRowSchema = z.object({
	// Required discriminator: identifies this as a convertible-bond row.
	code: z.string(),
	name: z.string().catch(""),
	stockCode: z.string().catch(""),
	rating: z.string().catch(""),
	listingDate: z.string().catch(""),
	expireDate: z.string().catch(""),
	issueScale: z.number().nullable().catch(null),
	issuePrice: z.number().nullable().catch(null),
});

export type ConvertibleBondRowData = z.infer<typeof ConvertibleBondRowSchema>;

// ---- finance_ipo ------------------------------------------------------------

export const IpoRowSchema = z.object({
	// Required discriminator: identifies this as an IPO-calendar row.
	code: z.string(),
	name: z.string().catch(""),
	applyCode: z.string().catch(""),
	applyDate: z.string().catch(""),
	listingDate: z.string().catch(""),
	market: z.string().catch(""),
	issuePrice: z.number().nullable().catch(null),
	applyUpper: z.number().nullable().catch(null),
	afterPe: z.number().nullable().catch(null),
	industryPe: z.number().nullable().catch(null),
});

export type IpoRowData = z.infer<typeof IpoRowSchema>;
