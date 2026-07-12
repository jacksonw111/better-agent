import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";
import type { TechnicalData } from "./finance-schemas";
import { formatDate, formatNum } from "./format";
import { CardShell, StatGrid, type StatGridItem } from "./primitives";

const MACD_DP = 3;
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;
const RSI_METER_MIN = 0;
const RSI_METER_MAX = 100;

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

const RSI_TEXT_COLOR: Partial<Record<RsiTone, string>> = {
	down: "#16a34a",
	up: "#ef4444",
};

const RSI_METER_FILL_CLASS: Record<RsiTone, string> = {
	down: "bg-[#16a34a]",
	muted: "bg-foreground/30",
	up: "bg-[#ef4444]",
};

function Section({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5 pt-1">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</span>
			{children}
		</div>
	);
}

function RsiMeter({ value }: { value: number | null }) {
	const tone = rsiTone(value);
	const fillClass = RSI_METER_FILL_CLASS[tone];
	const pct =
		value === null || Number.isNaN(value)
			? RSI_METER_MIN
			: Math.min(RSI_METER_MAX, Math.max(RSI_METER_MIN, value));
	return (
		<div className="flex items-center gap-2">
			<span
				className={cn(
					"w-12 shrink-0 font-medium text-sm tabular-nums",
					tone === "muted" ? "text-muted-foreground" : undefined
				)}
				style={{ color: RSI_TEXT_COLOR[tone] }}
			>
				{formatNum(value)}
			</span>
			<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
				<div
					className={cn("h-full rounded-full", fillClass)}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

function MacdBlock({ macd }: { macd: TechnicalData["macd"] }) {
	return (
		<Section label="MACD">
			<StatGrid
				items={[
					{ label: "DIF", value: formatNum(macd?.dif, MACD_DP) },
					{ label: "DEA", value: formatNum(macd?.dea, MACD_DP) },
					{
						label: "MACD",
						tone: signTone(macd?.macd),
						value: formatNum(macd?.macd, MACD_DP),
					},
				]}
			/>
		</Section>
	);
}

function KdjBlock({ kdj }: { kdj: TechnicalData["kdj"] }) {
	return (
		<Section label="KDJ">
			<StatGrid
				items={[
					{ label: "K", value: formatNum(kdj?.k) },
					{ label: "D", value: formatNum(kdj?.d) },
					{ label: "J", value: formatNum(kdj?.j) },
				]}
			/>
		</Section>
	);
}

function BollBlock({ boll }: { boll: TechnicalData["boll"] }) {
	return (
		<Section label="BOLL">
			<StatGrid
				items={[
					{ label: "上轨", value: formatNum(boll?.upper) },
					{ label: "中轨", value: formatNum(boll?.mid) },
					{ label: "下轨", value: formatNum(boll?.lower) },
				]}
			/>
		</Section>
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

/** finance_technical → header (symbol · period · asOf · close) + a StatGrid
 * of MA5/10/20/60 + EMA12/26, then labeled MACD / RSI14 / KDJ / BOLL blocks.
 * Every indicator is independently nullable (the provider may not have
 * enough history for a slow MA or a whole indicator family) — missing values
 * render "—" rather than blanking the surrounding block. */
export function TechnicalPanel({ data }: { data: TechnicalData }) {
	return (
		<CardShell
			right={<CloseFigure close={data.close} />}
			subtitle={subtitleOf(data.period, data.asOf)}
			title={data.symbol}
		>
			<StatGrid
				items={[
					{ label: "MA5", value: formatNum(data.ma5) },
					{ label: "MA10", value: formatNum(data.ma10) },
					{ label: "MA20", value: formatNum(data.ma20) },
					{ label: "MA60", value: formatNum(data.ma60) },
					{ label: "EMA12", value: formatNum(data.ema12) },
					{ label: "EMA26", value: formatNum(data.ema26) },
				]}
			/>
			<MacdBlock macd={data.macd} />
			<Section label="RSI14">
				<RsiMeter value={data.rsi14} />
			</Section>
			<KdjBlock kdj={data.kdj} />
			<BollBlock boll={data.boll} />
		</CardShell>
	);
}
