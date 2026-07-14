import { z } from "zod";

// FE-15 (V7) slice: finance_block_trades (block-trades-table.tsx),
// finance_insider_trades (insider-table.tsx), finance_suspension
// (suspension-table.tsx). Mirrors BlockTradeRow / InsiderRow / SuspensionRow
// in apps/finance-mcp/src/core/types-events.ts. Split out into its own file
// — same pattern as finance-schemas-fe14.ts (finance-schemas.ts is at the
// project's 300-line-per-file cap).

// ---- finance_block_trades -----------------------------------------------

export const BlockTradeRowSchema = z.object({
	// Required discriminator: identifies this as a block-trade row.
	tradeDate: z.string(),
	code: z.string().catch(""),
	name: z.string().catch(""),
	dealPrice: z.number().nullable().catch(null),
	premiumPct: z.number().nullable().catch(null),
	dealVolume: z.number().nullable().catch(null),
	dealAmount: z.number().nullable().catch(null),
	buyer: z.string().catch(""),
	seller: z.string().catch(""),
});

export type BlockTradeRowData = z.infer<typeof BlockTradeRowSchema>;

// ---- finance_insider_trades ------------------------------------------------

export const InsiderRowSchema = z.object({
	// Required discriminator: identifies this as an insider-trade row.
	changeDate: z.string(),
	code: z.string().catch(""),
	name: z.string().catch(""),
	person: z.string().catch(""),
	position: z.string().catch(""),
	holdType: z.string().catch(""),
	changeShares: z.number().nullable().catch(null),
	avgPrice: z.number().nullable().catch(null),
	changeAmount: z.number().nullable().catch(null),
	changeRatio: z.number().nullable().catch(null),
	relatedExec: z.string().catch(""),
	reason: z.string().catch(""),
});

export type InsiderRowData = z.infer<typeof InsiderRowSchema>;

// ---- finance_suspension ------------------------------------------------------

export const SuspensionRowSchema = z.object({
	// Required discriminator: identifies this as a suspension row.
	suspendStart: z.string(),
	code: z.string().catch(""),
	name: z.string().catch(""),
	suspendEnd: z.string().nullable().catch(null),
	expire: z.string().nullable().catch(null),
	reason: z.string().nullable().catch(null),
	predictResume: z.string().nullable().catch(null),
});

export type SuspensionRowData = z.infer<typeof SuspensionRowSchema>;
