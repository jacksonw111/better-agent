import { listEntry, type ToolResultRenderer } from "../tool-renderers";
import { CommodityGrid } from "./commodity-grid";
import { CommodityQuoteSchema, IndexQuoteSchema } from "./finance-schemas";
import { IndexGrid } from "./index-grid";

// Tool name → { parse, render } for the finance tool results. Spread into
// TOOL_RESULT_RENDERERS by ../tool-renderers.tsx. `listEntry` (and `entry`,
// used by later batches) are function declarations (hoisted), so this module
// can safely import them back from ../tool-renderers.tsx even though that
// module imports FINANCE_RENDERERS from here — the cycle only ever runs
// through hoisted bindings that are ready before either module's top-level
// code executes.
//
// FE-1 scope: finance_index_quote + finance_commodity only. Later batches add
// finance_quote / finance_kline / finance_technical here.
export const FINANCE_RENDERERS: Record<string, ToolResultRenderer> = {
	finance_commodity: listEntry(CommodityQuoteSchema, (items) => (
		<CommodityGrid items={items} />
	)),
	finance_index_quote: listEntry(IndexQuoteSchema, (items) => (
		<IndexGrid items={items} />
	)),
};
