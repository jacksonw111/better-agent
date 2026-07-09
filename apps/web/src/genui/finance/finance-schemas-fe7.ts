import { z } from "zod";

// FE-7 slice: finance_macro_us / finance_macro_cn (macro-panel.tsx) and
// finance_earnings_calendar / finance_economic_calendar / finance_central_bank
// (calendar-list.tsx). Mirrors MacroSeries / MacroDashboard / EarningsEvent /
// EconomicEvent / CbOp in apps/finance-mcp/src/core/types.ts, plus
// MacroCnResult in apps/finance-mcp/src/core/eastmoney/macro.ts — CN macro
// values have no shared TS interface across indicators (each report exposes
// its own field set), so those schemas stay deliberately permissive rather
// than pinning one shape. Split out of finance-schemas.ts (which is at the
// project's 300-line-per-file cap) — same pattern as finance-schemas-fe6.ts.

// ---- finance_macro_us / finance_macro_cn ------------------------------

const MacroObservationSchema = z.object({
	date: z.string(),
	value: z.number().catch(0),
});

export type MacroObservationData = z.infer<typeof MacroObservationSchema>;

// CN rows/latest entries are a free-form indicator report row (cpi: yoy/mom/
// cumulative, pmi: manufacturing/nonManufacturing, m2: m0/m0Yoy/m1/m1Yoy/...):
// `time` is the one field every indicator's report always carries, so it's
// the only fixed key — everything else passes through `.catchall`.
export const MacroCnRowSchema = z
	.object({ time: z.string().nullable().catch(null) })
	.catchall(z.union([z.number(), z.string()]).nullable());

export type MacroCnRowData = z.infer<typeof MacroCnRowSchema>;

const MacroUsDashboardRowSchema = z.object({
	date: z.string().nullable().optional(),
	indicator: z.string(),
	seriesId: z.string().nullable().optional(),
	value: z.number().nullable().optional(),
});

const MacroCnDashboardRowSchema = z.object({
	indicator: z.string(),
	latest: MacroCnRowSchema.nullable(),
});

// CN's dedicated shape (requires `latest`) is tried first: every field on the
// US shape is optional, so it would also "succeed" against a CN row and
// silently drop `latest` if the order were reversed.
const MacroDashboardRowSchema = z.union([
	MacroCnDashboardRowSchema,
	MacroUsDashboardRowSchema,
]);

export type MacroDashboardRowData = z.infer<typeof MacroDashboardRowSchema>;

/** Resilient union-of-shapes schema shared by finance_macro_us and
 * finance_macro_cn: `dashboard` (all-indicators overview, US or CN row
 * shape), `observations` (macro_us single-indicator series), or `rows`
 * (macro_cn single-indicator series). At least one of the three must be
 * present as an array or this isn't a macro result at all. */
export const MacroResultSchema = z
	.object({
		dashboard: z.array(MacroDashboardRowSchema).optional(),
		indicator: z.string().optional(),
		observations: z.array(MacroObservationSchema).optional(),
		rows: z.array(MacroCnRowSchema).optional(),
		seriesId: z.string().nullable().optional(),
	})
	.refine(
		(data) =>
			Array.isArray(data.dashboard) ||
			Array.isArray(data.observations) ||
			Array.isArray(data.rows),
		{ message: "expected a macro dashboard, observations, or rows array" }
	);

export type MacroResultData = z.infer<typeof MacroResultSchema>;

// ---- finance_earnings_calendar / finance_economic_calendar /
// finance_central_bank --------------------------------------------------

// A single permissive element schema covers all three array results: each
// tool only ever returns rows of its own shape, so `date` is the sole
// required discriminator and every other field is optional — the renderer
// (calendar-list.tsx) tells the three shapes apart by which optional fields
// are actually present on the first row (symbol → earnings, event →
// economic, otherwise → central bank).
export const CalendarEventSchema = z.object({
	// Required discriminator: every event/operation carries a date.
	date: z.string(),
	// finance_earnings_calendar (EarningsEvent)
	isPublished: z.boolean().optional(),
	market: z.string().optional(),
	name: z.string().optional(),
	reportType: z.string().nullable().optional(),
	session: z.string().nullable().optional(),
	symbol: z.string().optional(),
	// finance_economic_calendar (EconomicEvent)
	actual: z.string().nullable().optional(),
	country: z.string().optional(),
	estimate: z.string().nullable().optional(),
	event: z.string().optional(),
	impact: z.string().nullable().optional(),
	prior: z.string().nullable().optional(),
	time: z.string().nullable().optional(),
	// finance_central_bank (CbOp)
	amount: z.number().nullable().optional(),
	rate: z.number().nullable().optional(),
	tenor: z.string().nullable().optional(),
	type: z.string().optional(),
});

export type CalendarEventData = z.infer<typeof CalendarEventSchema>;
