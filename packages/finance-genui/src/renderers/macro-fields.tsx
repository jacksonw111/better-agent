"use client";

import type { ReactNode } from "react";
import type {
	MacroCnRowData,
	MacroDashboardRowData,
} from "./finance-schemas-fe7";
import { formatCompact, formatNum } from "./format";
import { ChangePct, type StatGridItem } from "./primitives";

// finance_macro_us / finance_macro_cn share these label/format helpers across
// their three archetype ports — macro-series.tsx (LineSeries), macro-cn-table
// .tsx (DataTable), macro-dashboard.tsx (StatPanel); see macro-panel.tsx for
// the dispatcher that routes between them. Kept in one module so none of the
// branch files redeclare the indicator/CN-field label maps.

const INDICATOR_LABEL: Record<string, string> = {
	core_cpi: "核心CPI",
	cpi: "CPI",
	cpi_yoy: "CPI同比",
	fed_funds: "联邦基金利率",
	gdp: "GDP",
	industrial: "工业产出",
	m2: "M2货币供应",
	nonfarm: "非农就业",
	pce: "PCE",
	pmi: "PMI",
	ppi: "PPI",
	real_gdp: "实际GDP",
	retail_sales: "零售销售",
	treasury_10y: "10年期国债收益率",
	treasury_2y: "2年期国债收益率",
	unemployment: "失业率",
};

export function indicatorLabel(indicator: string): string {
	return INDICATOR_LABEL[indicator] ?? indicator;
}

// CN field keys come straight from apps/finance-mcp/src/core/eastmoney/macro.ts
// REPORTS: "pct" fields are YoY/MoM/cumulative growth rates (colored,
// directional), "index" fields are PMI-style diffusion indices (plain
// number), everything else is an absolute level (万/亿-scale amount).
type CnFieldKind = "amount" | "index" | "pct";

const CN_FIELD_META: Record<string, { kind: CnFieldKind; label: string }> = {
	cumulative: { kind: "pct", label: "累计同比" },
	gdp: { kind: "amount", label: "GDP总量" },
	m0: { kind: "amount", label: "M0" },
	m0Yoy: { kind: "pct", label: "M0同比" },
	m1: { kind: "amount", label: "M1" },
	m1Yoy: { kind: "pct", label: "M1同比" },
	m2: { kind: "amount", label: "M2" },
	m2Yoy: { kind: "pct", label: "M2同比" },
	manufacturing: { kind: "index", label: "制造业PMI" },
	mom: { kind: "pct", label: "环比" },
	nonManufacturing: { kind: "index", label: "非制造业PMI" },
	yoy: { kind: "pct", label: "同比" },
};

export function cnFieldLabel(key: string): string {
	return CN_FIELD_META[key]?.label ?? key;
}

/** Display cell for a CN field — pct fields render via `ChangePct`, index
 * fields via `formatNum`, everything else (amount) via `formatCompact`. Used
 * as a DataTable column's `render`; see `cnFieldNumericValue` below for the
 * separate raw-number accessor that makes numeric columns sortable/pivotable. */
export function formatCnFieldValue(
	key: string,
	value: number | string | null | undefined
): ReactNode {
	if (typeof value === "string") {
		return value || "—";
	}
	if (value === null || value === undefined) {
		return "—";
	}
	const kind = CN_FIELD_META[key]?.kind ?? "amount";
	if (kind === "pct") {
		return <ChangePct value={value} />;
	}
	if (kind === "index") {
		return formatNum(value);
	}
	return formatCompact(value);
}

/** Raw numeric accessor for a CN field, distinct from `formatCnFieldValue`'s
 * display node — DataTable's `value` accessor needs the bare number to sort
 * and pivot-to-line a column; string fields (or nulls) resolve to `null`. */
export function cnFieldNumericValue(
	key: string,
	row: MacroCnRowData
): number | null {
	const value = row[key];
	return typeof value === "number" ? value : null;
}

export function cnRowFields(row: MacroCnRowData): string[] {
	return Object.keys(row).filter((key) => key !== "time");
}

/** Picks one representative field to summarize a CN indicator's latest
 * report for the dashboard StatPanel: prefers `yoy` (the field most CN
 * indicators expose), then the first other non-null field. */
export function pickCnPrimaryField(
	latest: MacroCnRowData | null
): { key: string; value: number | string | null } | null {
	if (!latest) {
		return null;
	}
	if (latest.yoy !== null && latest.yoy !== undefined) {
		return { key: "yoy", value: latest.yoy };
	}
	for (const key of cnRowFields(latest)) {
		const value = latest[key];
		if (value !== null && value !== undefined) {
			return { key, value };
		}
	}
	return null;
}

export function dashboardItem(row: MacroDashboardRowData): StatGridItem {
	const label = indicatorLabel(row.indicator);
	if ("latest" in row) {
		const primary = pickCnPrimaryField(row.latest);
		return {
			label,
			value: primary ? formatCnFieldValue(primary.key, primary.value) : "—",
		};
	}
	return { label, value: formatNum(row.value) };
}
