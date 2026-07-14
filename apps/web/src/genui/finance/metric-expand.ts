import type { DataTableColumn } from "./data-table-types";
import type { StatGridItem } from "./primitives";

// Shared by every DataTable-based finance tool's `renderExpanded` (statements,
// indicators, dividends, forecast, and the rest of §9's 12 archetype tools):
// every non-null metric field for the single row the user drilled into,
// rendered with the same formatter as its column. Extracted from the
// `financial_statements` flagship (statements-table.tsx) once a second and
// third caller needed the identical logic — see Phase 1 Batch B1.

/** Non-null `isMetric` fields of `row`, as `StatGridItem`s ready for
 * `<StatGrid>`. Columns without a `value` accessor (categoryKey, text-only
 * fields) are skipped — only plottable metric columns belong in the expand
 * detail, matching the flagship's behavior. */
export function expandedMetricFields<T>(
	columns: DataTableColumn<T>[],
	row: T
): StatGridItem[] {
	const items: StatGridItem[] = [];
	for (const col of columns) {
		if (!(col.isMetric && col.value)) {
			continue;
		}
		const raw = col.value(row);
		if (raw === null) {
			continue;
		}
		items.push({ label: col.label, value: col.render?.(row) ?? raw });
	}
	return items;
}

/** Every column's value for `row` (§8.1 "全字段"), for tools whose drill-down
 * is the full record rather than just its plottable metrics — e.g. block
 * trades / insider changes, which have no `isMetric` column at all (they're
 * event lists, not trends) yet still want buyer/seller/reason etc. behind
 * Expand. The `categoryKey` column is skipped since it's already the row's
 * sticky anchor. Columns rendering empty/null are dropped. */
export function expandedAllFields<T>(
	columns: DataTableColumn<T>[],
	row: T,
	categoryKey: string
): StatGridItem[] {
	const items: StatGridItem[] = [];
	for (const col of columns) {
		if (col.key === categoryKey) {
			continue;
		}
		const rawValue = col.value?.(row) ?? null;
		const content = col.render?.(row) ?? rawValue;
		if (content === null || content === undefined || content === "") {
			continue;
		}
		items.push({ label: col.label, value: content });
	}
	return items;
}
