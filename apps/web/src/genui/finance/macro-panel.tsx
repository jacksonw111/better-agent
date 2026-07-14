"use client";

import type { MacroResultData } from "./finance-schemas-fe7";
import { MacroCnRowsTable } from "./macro-cn-table";
import { MacroDashboardGrid } from "./macro-dashboard";
import { MacroSeriesChart } from "./macro-series";

// finance_macro_us / finance_macro_cn share this dispatcher because their
// result is a 3-way union (see MacroResultSchema): a dashboard of every
// indicator (US or CN row shape) → StatPanel (macro-dashboard.tsx), a US
// single-indicator FRED time series → LineSeries (macro-series.tsx), or a CN
// single-indicator EastMoney report history → DataTable (macro-cn-table.tsx).
// Shared label/format helpers live in macro-fields.ts. This file only
// branches — it owns no rendering, and (deliberately) no recharts import:
// every archetype below lazy-loads recharts itself.
export function MacroPanel({ data }: { data: MacroResultData }) {
	if (data.dashboard) {
		return <MacroDashboardGrid rows={data.dashboard} />;
	}
	if (data.observations) {
		return (
			<MacroSeriesChart
				indicator={data.indicator ?? ""}
				observations={data.observations}
				seriesId={data.seriesId}
			/>
		);
	}
	if (data.rows) {
		return (
			<MacroCnRowsTable indicator={data.indicator ?? ""} rows={data.rows} />
		);
	}
	return null;
}
