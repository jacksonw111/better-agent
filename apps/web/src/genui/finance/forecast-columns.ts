import type { DataTableColumn } from "./data-table-types";
import type { ForecastRowData } from "./finance-schemas-fe8";
import { formatCompact, formatNum } from "./format";

// Phase 1 Batch B1 — column config for `earnings_forecast` (design doc §9).
// No institution/rating field exists on ForecastRowSchema (one row per
// fiscal year — this FY / next / +2, not per-analyst), so `year` is the
// categoryKey and there's nothing to build a `filters` prop from. `eps`/`pe`/
// `revenue` get a `value` accessor (sortable) but deliberately NOT
// `isMetric`: forecast.ts (apps/finance-mcp) emits rows ascending by year
// (baseYear, +1, +2) — the opposite of every other DataTable tool's
// newest-first convention (DataTableChart's chart ordering is date/number-
// aware and handles either direction correctly, so that's no longer a
// blocker). A 3-year point forecast just isn't a meaningful trend line
// (spec §9's "if not, leave them sortable-but-not-metric" judgment call).

const YEAR_COLUMN: DataTableColumn<ForecastRowData> = {
	key: "year",
	label: "年度",
	render: (row) => row.year || "—",
};

const EPS_COLUMN: DataTableColumn<ForecastRowData> = {
	align: "right",
	key: "eps",
	label: "EPS",
	render: (row) => formatNum(row.eps),
	value: (row) => row.eps,
};

const PE_COLUMN: DataTableColumn<ForecastRowData> = {
	align: "right",
	key: "pe",
	label: "PE",
	render: (row) => formatNum(row.pe),
	value: (row) => row.pe,
};

const REVENUE_COLUMN: DataTableColumn<ForecastRowData> = {
	align: "right",
	key: "revenue",
	label: "营收",
	render: (row) =>
		row.revenue === null ? "—" : formatCompact(row.revenue, { cny: true }),
	value: (row) => row.revenue,
};

/** `year` (categoryKey) + EPS/PE, plus 营收 only when at least one row
 * actually carries it — mirrors the pre-DataTable forecast-table's
 * conditional column (revenue is optional on ForecastRow). */
export function forecastColumns(
	hasRevenue: boolean
): DataTableColumn<ForecastRowData>[] {
	const base = [YEAR_COLUMN, EPS_COLUMN, PE_COLUMN];
	return hasRevenue ? [...base, REVENUE_COLUMN] : base;
}
