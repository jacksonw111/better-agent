import { z } from "zod";

// FE-14 (V6b) slice: finance_index_weights (index-weights.tsx),
// finance_etf_list (etf-list.tsx), finance_option_chain (option-chain.tsx).
// Mirrors IndexWeightRow / EtfRow / OptionRow in
// apps/finance-mcp/src/core/types-data.ts. Split out into its own file —
// same pattern as finance-schemas-fe13.ts (finance-schemas.ts is at the
// project's 300-line-per-file cap).

// ---- finance_index_weights --------------------------------------------

export const IndexWeightRowSchema = z.object({
	// Required discriminator: identifies this as an index-constituent row.
	code: z.string(),
	name: z.string().catch(""),
	weight: z.number().nullable().catch(null),
	closePrice: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	industry: z.string().catch(""),
	pe: z.number().nullable().catch(null),
	roe: z.number().nullable().catch(null),
});

export type IndexWeightRowData = z.infer<typeof IndexWeightRowSchema>;

// ---- finance_etf_list ---------------------------------------------------

export const EtfRowSchema = z.object({
	// Required discriminator: identifies this as an ETF quote row.
	code: z.string(),
	name: z.string().catch(""),
	price: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	volume: z.number().nullable().catch(null),
	turnover: z.number().nullable().catch(null),
	turnoverRate: z.number().nullable().catch(null),
});

export type EtfRowData = z.infer<typeof EtfRowSchema>;

// ---- finance_option_chain -------------------------------------------------

export const OptionRowSchema = z.object({
	// Required discriminator: identifies this as an option-contract row.
	code: z.string(),
	name: z.string().catch(""),
	last: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
	volume: z.number().nullable().catch(null),
	kind: z.enum(["call", "put"]).catch("call"),
	strike: z.number().nullable().catch(null),
});

export type OptionRowData = z.infer<typeof OptionRowSchema>;
