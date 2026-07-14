import type { ReactNode } from "react";
import { Badge } from "../components/badge";
import type { CalendarEventData } from "./finance-schemas-fe7";
import { formatCompact, formatRatio } from "./format";

// Phase 3 Task 4 — the `renderEvent` / `renderExpanded` callbacks for the 3
// finance_earnings_calendar / finance_economic_calendar / finance_central_bank
// tools sharing the `EventCalendar` archetype (design doc §8.9). Row = time/
// name + the tool's key figures (ported from the old calendar-list.tsx
// FinTable columns); Expand = the event's full record, spelled out. Split out
// of calendar-list.tsx to respect the 299-line file cap.

type ImpactVariant = "default" | "destructive" | "outline";

const IMPACT_VARIANT: Record<string, ImpactVariant> = {
	high: "destructive",
	low: "outline",
	med: "default",
	medium: "default",
};

const IMPACT_LABEL: Record<string, string> = {
	high: "高",
	low: "低",
	med: "中",
	medium: "中",
};

/** Impact is a discrete category, not the price/sentiment axis (§5.2) — a
 * neutral `Badge` variant, never `changeColor`/sentiment colors. */
export function ImpactBadge({ impact }: { impact: string | null | undefined }) {
	if (!impact) {
		return <span className="text-muted-foreground">—</span>;
	}
	const key = impact.toLowerCase();
	return (
		<Badge variant={IMPACT_VARIANT[key] ?? "outline"}>
			{IMPACT_LABEL[key] ?? impact}
		</Badge>
	);
}

const SESSION_LABEL: Record<string, string> = {
	"after-hours": "盘后",
	"pre-market": "盘前",
};

/** A right-aligned label/value pair, e.g. an economic event's 实际/预期/前值
 * or a central-bank op's 利率. */
function FigureStat({ label, value }: { label: string; value: ReactNode }) {
	return (
		<span className="flex flex-col items-end gap-0">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-medium text-xs tabular-nums">{value}</span>
		</span>
	);
}

/** A single `label: value` line inside an Expand detail block. */
function DetailField({ label, value }: { label: string; value: ReactNode }) {
	return (
		<span className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground">{label}</span>
			<span className="tabular-nums">{value}</span>
		</span>
	);
}

export function renderEarningsEvent(row: CalendarEventData): ReactNode {
	return (
		<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="truncate font-medium text-sm">
					{row.symbol || "—"}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{row.name || "—"}
				</span>
			</div>
			{row.session ? (
				<Badge variant="outline">
					{SESSION_LABEL[row.session] ?? row.session}
				</Badge>
			) : null}
		</div>
	);
}

export function renderEarningsExpanded(row: CalendarEventData): ReactNode {
	return (
		<>
			<DetailField label="市场" value={row.market?.toUpperCase() || "—"} />
			<DetailField label="报告类型" value={row.reportType || "—"} />
			<DetailField label="状态" value={row.isPublished ? "已发布" : "待发布"} />
		</>
	);
}

export function renderEconomicEvent(row: CalendarEventData): ReactNode {
	return (
		<div className="flex min-w-0 flex-1 items-center justify-between gap-3">
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="truncate font-medium text-sm">{row.event || "—"}</span>
				<span className="truncate text-muted-foreground text-xs">
					{[row.country, row.time].filter(Boolean).join(" · ") || "—"}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-2.5">
				<FigureStat label="前值" value={row.prior || "—"} />
				<FigureStat label="预期" value={row.estimate || "—"} />
				<FigureStat label="实际" value={row.actual || "—"} />
				<ImpactBadge impact={row.impact} />
			</div>
		</div>
	);
}

export function renderEconomicExpanded(row: CalendarEventData): ReactNode {
	return (
		<>
			<DetailField label="国家/地区" value={row.country || "—"} />
			<DetailField label="发布时间" value={row.time || "—"} />
			<DetailField
				label="重要度"
				value={
					row.impact
						? (IMPACT_LABEL[row.impact.toLowerCase()] ?? row.impact)
						: "—"
				}
			/>
		</>
	);
}

export function renderCentralBankEvent(row: CalendarEventData): ReactNode {
	return (
		<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="truncate font-medium text-sm">{row.type || "—"}</span>
				<span className="truncate text-muted-foreground text-xs">
					{row.tenor || "—"}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-2.5">
				<FigureStat label="利率" value={formatRatio(row.rate)} />
			</div>
		</div>
	);
}

export function renderCentralBankExpanded(row: CalendarEventData): ReactNode {
	return (
		<>
			<DetailField label="期限" value={row.tenor || "—"} />
			<DetailField label="金额" value={formatCompact(row.amount)} />
		</>
	);
}
