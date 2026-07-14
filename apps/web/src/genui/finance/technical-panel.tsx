import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";
import type { TechnicalData } from "./finance-schemas";
import { DOWN_COLOR, formatDate, formatNum, UP_COLOR } from "./format";
import type { StatGridItem } from "./primitives";
import { StatPanel } from "./stat-panel";
import { StatPanelGroupView } from "./stat-panel-group";
import type { StatPanelGroup } from "./stat-panel-types";

const MACD_DP = 3;
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;
const RSI_METER_MIN = 0;
const RSI_METER_MAX = 100;
const MA_COLS = 3;

function signTone(n: number | null | undefined): StatGridItem["tone"] {
	if (n === null || n === undefined || Number.isNaN(n) || n === 0) {
		return "muted";
	}
	return n > 0 ? "up" : "down";
}

type RsiTone = "up" | "down" | "muted";

function rsiTone(n: number | null): RsiTone {
	if (n === null || Number.isNaN(n)) {
		return "muted";
	}
	if (n < RSI_OVERSOLD) {
		return "down";
	}
	if (n > RSI_OVERBOUGHT) {
		return "up";
	}
	return "muted";
}

// RSI's oversold(<30)/overbought(>70) signal-highlight reuses the price
// axis's red-up/green-down convention (§5.2) — sourced from `UP_COLOR`/
// `DOWN_COLOR` (./format) via inline `style`, never a hardcoded hex or a
// `bg-[#..]` arbitrary class (the pre-commit Tailwind gate bans the latter).
const RSI_FILL_COLOR: Partial<Record<RsiTone, string>> = {
	down: DOWN_COLOR,
	up: UP_COLOR,
};

function RsiMeter({ value }: { value: number | null }) {
	const tone = rsiTone(value);
	const fillColor = RSI_FILL_COLOR[tone];
	const pct =
		value === null || Number.isNaN(value)
			? RSI_METER_MIN
			: Math.min(RSI_METER_MAX, Math.max(RSI_METER_MIN, value));
	return (
		<div className="flex items-center gap-2">
			<span
				className={cn(
					"w-12 shrink-0 font-medium text-sm tabular-nums",
					fillColor ? undefined : "text-muted-foreground"
				)}
				style={fillColor ? { color: fillColor } : undefined}
			>
				{formatNum(value)}
			</span>
			<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
				<div
					className={cn(
						"h-full rounded-full",
						fillColor ? undefined : "bg-foreground/30"
					)}
					style={{ backgroundColor: fillColor, width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

/** KDJ + BOLL, folded behind the Expand toggle — reuses `StatPanelGroupView`
 * directly (same label styling as the always-visible groups) rather than a
 * bespoke `Section` wrapper. */
function kdjBollContent(data: TechnicalData): ReactNode {
	return (
		<>
			<StatPanelGroupView
				group={{
					items: [
						{ label: "K", value: formatNum(data.kdj?.k) },
						{ label: "D", value: formatNum(data.kdj?.d) },
						{ label: "J", value: formatNum(data.kdj?.j) },
					],
					label: "KDJ",
				}}
			/>
			<StatPanelGroupView
				group={{
					items: [
						{ label: "上轨", value: formatNum(data.boll?.upper) },
						{ label: "中轨", value: formatNum(data.boll?.mid) },
						{ label: "下轨", value: formatNum(data.boll?.lower) },
					],
					label: "BOLL",
				}}
			/>
		</>
	);
}

function subtitleOf(period: string, asOf: string): string | undefined {
	const asOfFormatted = formatDate(asOf);
	const parts = [period, asOfFormatted === "—" ? "" : asOfFormatted].filter(
		Boolean
	);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function CloseFigure({ close }: { close: number | null }) {
	return (
		<div className="flex flex-col items-end gap-0.5">
			<span className="text-muted-foreground text-xs">收盘</span>
			<span className="font-semibold text-sm tabular-nums">
				{formatNum(close)}
			</span>
		</div>
	);
}

function technicalGroups(data: TechnicalData): StatPanelGroup[] {
	return [
		{
			cols: MA_COLS,
			items: [
				{ label: "MA5", value: formatNum(data.ma5) },
				{ label: "MA10", value: formatNum(data.ma10) },
				{ label: "MA20", value: formatNum(data.ma20) },
				{ label: "MA60", value: formatNum(data.ma60) },
				{ label: "EMA12", value: formatNum(data.ema12) },
				{ label: "EMA26", value: formatNum(data.ema26) },
			],
			label: "均线",
		},
		{
			items: [
				{ label: "DIF", value: formatNum(data.macd?.dif, MACD_DP) },
				{ label: "DEA", value: formatNum(data.macd?.dea, MACD_DP) },
				{
					label: "MACD",
					tone: signTone(data.macd?.macd),
					value: formatNum(data.macd?.macd, MACD_DP),
				},
			],
			label: "MACD",
		},
		{ content: <RsiMeter value={data.rsi14} />, label: "RSI14" },
	];
}

/** finance_technical → StatPanel: header (symbol · period · asOf + 收盘 in
 * `right`), 均线 (MA5/10/20/60 + EMA12/26) and MACD (DIF/DEA/MACD, tone by
 * sign) and RSI14 (the oversold/overbought-highlighted meter) always-
 * visible, KDJ + BOLL behind Expand ("KDJ · BOLL"). Every indicator is
 * independently nullable (the provider may not have enough history for a
 * slow MA or a whole indicator family) — missing values render "—" rather
 * than blanking the surrounding group. */
export function TechnicalPanel({ data }: { data: TechnicalData }) {
	return (
		<StatPanel
			expandable={{ content: kdjBollContent(data), label: "KDJ · BOLL" }}
			groups={technicalGroups(data)}
			right={<CloseFigure close={data.close} />}
			subtitle={subtitleOf(data.period, data.asOf)}
			title={data.symbol}
		/>
	);
}
