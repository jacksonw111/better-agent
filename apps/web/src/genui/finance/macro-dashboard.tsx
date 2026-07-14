"use client";

import type { MacroDashboardRowData } from "./finance-schemas-fe7";
import { dashboardItem } from "./macro-fields";
import { StatPanel } from "./stat-panel";

// finance_macro_us / finance_macro_cn's `dashboard` branch (every
// indicator's latest value, no time axis) on the `StatPanel` archetype — a
// single always-visible group, no Expand (nothing secondary to reveal).

/** finance_macro_us / finance_macro_cn → the all-indicators overview. */
export function MacroDashboardGrid({
	rows,
}: {
	rows: MacroDashboardRowData[];
}) {
	if (rows.length === 0) {
		return null;
	}
	return (
		<StatPanel groups={[{ items: rows.map(dashboardItem) }]} title="宏观指标" />
	);
}
