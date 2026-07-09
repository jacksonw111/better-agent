import { z } from "zod";

// FE-6 slice: finance_money_flow / finance_sector_list /
// finance_sector_constituents / finance_yield_curve. Mirrors MoneyFlowRow /
// SectorRow / SectorConstituent / YieldPoint in
// apps/finance-mcp/src/core/types.ts. Split out of finance-schemas.ts (which
// is at the project's 300-line-per-file cap) — same pattern as
// types.ts/types-extra.ts splitting in apps/finance-mcp. Each is an array
// result (see listEntry in finance-renderers.tsx).

export const MoneyFlowRowSchema = z.object({
	// Required discriminator: identifies this as a money-flow-by-day row.
	date: z.string(),
	mainNet: z.number().catch(0),
	smallNet: z.number().catch(0),
	mediumNet: z.number().catch(0),
	largeNet: z.number().catch(0),
	superNet: z.number().catch(0),
});

export type MoneyFlowRowData = z.infer<typeof MoneyFlowRowSchema>;

export const SectorRowSchema = z.object({
	// Required discriminator: identifies this as a sector/board row.
	code: z.string(),
	name: z.string().catch(""),
	changePct: z.number().nullable().catch(null),
	mainNet: z.number().nullable().catch(null),
	price: z.number().nullable().catch(null),
	leadStockCode: z.string().catch(""),
	leadStockChangePct: z.number().nullable().catch(null),
});

export type SectorRowData = z.infer<typeof SectorRowSchema>;

export const SectorConstituentSchema = z.object({
	// Required discriminator: identifies this as a sector-constituent row.
	code: z.string(),
	name: z.string().catch(""),
	price: z.number().nullable().catch(null),
	changePct: z.number().nullable().catch(null),
});

export type SectorConstituentData = z.infer<typeof SectorConstituentSchema>;

export const YieldPointSchema = z.object({
	// Required discriminator: identifies this as a yield-curve tenor point.
	tenor: z.string(),
	seriesId: z.string().catch(""),
	date: z.string().catch(""),
	yield: z.number().nullable().catch(null),
});

export type YieldPointData = z.infer<typeof YieldPointSchema>;
