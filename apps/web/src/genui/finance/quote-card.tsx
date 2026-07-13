import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import type { DepthLevelData, QuoteData } from "./finance-schemas";
import {
	changeColor,
	DOWN_COLOR,
	formatCompact,
	formatNum,
	UP_COLOR,
} from "./format";
import { CardShell, ChangePct, StatGrid } from "./primitives";
import { ProportionBar } from "./proportion-bar";

const MAX_DEPTH_LEVELS = 5;

const MARKET_LABELS: Record<string, string> = {
	a: "A股",
	hk: "港股",
	us: "美股",
};

function marketLabel(market: string): string {
	return MARKET_LABELS[market.toLowerCase()] || market.toUpperCase() || "—";
}

function formatSignedNum(n: number | null, dp = 2): string {
	if (n === null || Number.isNaN(n)) {
		return "—";
	}
	const sign = n > 0 ? "+" : "";
	return `${sign}${formatNum(n, dp)}`;
}

interface DepthRow {
	label: string;
	level: DepthLevelData;
}

function toDepthRows(levels: DepthLevelData[], prefix: string): DepthRow[] {
	return levels
		.slice(0, MAX_DEPTH_LEVELS)
		.map((level, index) => ({ label: `${prefix}${index + 1}`, level }));
}

function maxDepthVolume(rows: DepthRow[]): number {
	let max = 0;
	for (const row of rows) {
		const volume = row.level.volume ?? 0;
		if (volume > max) {
			max = volume;
		}
	}
	return max;
}

type DepthSide = "ask" | "bid";

// Depth ladder colors come from the price axis (§5.2): asks 卖 use
// DOWN_COLOR (green), bids 买 use UP_COLOR (red) — matches the existing
// 红涨绿跌 depth-ladder convention, sourced from format.ts instead of a
// locally hardcoded hex pair.
const DEPTH_TONE: Record<DepthSide, "up" | "down"> = { ask: "down", bid: "up" };
const DEPTH_TEXT_COLOR: Record<DepthSide, string> = {
	ask: DOWN_COLOR,
	bid: UP_COLOR,
};

/** One 盘口 row: the row's own background fill (width ∝ volume share of the
 * ladder's max) is delegated to `ProportionBar`'s overlay variant instead of
 * a locally hand-rolled absolutely-positioned bar. */
function DepthRowLine({
	row,
	side,
	maxVolume,
}: {
	row: DepthRow;
	side: DepthSide;
	maxVolume: number;
}) {
	const { level } = row;
	const textColor = DEPTH_TEXT_COLOR[side];
	return (
		<ProportionBar
			className="rounded px-1.5 py-0.5 text-xs"
			max={maxVolume}
			tone={DEPTH_TONE[side]}
			value={level.volume ?? 0}
			variant="overlay"
		>
			{/* ProportionBar's overlay variant wraps `children` in its own div,
			 * so the 3-column layout has to live inside that wrapper rather than
			 * on ProportionBar's own className (which sizes the fill's track). */}
			<div className="grid grid-cols-[2.5rem_1fr_1fr] items-center">
				<span className="text-muted-foreground">{row.label}</span>
				<span className="text-right tabular-nums" style={{ color: textColor }}>
					{formatNum(level.price)}
				</span>
				<span className="text-right text-muted-foreground tabular-nums">
					{formatCompact(level.volume)}
				</span>
			</div>
		</ProportionBar>
	);
}

/** 盘口 depth ladder: asks 卖5→卖1 stacked above bids 买1→买5, each row's
 * background bar width proportional to its volume share. Renders whatever
 * levels are present (US/HK quotes commonly have ≤1) and nothing at all when
 * both sides are empty. */
function DepthLadder({
	askRows,
	bidRows,
	maxVolume,
}: {
	askRows: DepthRow[];
	bidRows: DepthRow[];
	maxVolume: number;
}) {
	if (askRows.length === 0 && bidRows.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-0.5 pt-2">
			{askRows.map((row) => (
				<DepthRowLine
					key={row.label}
					maxVolume={maxVolume}
					row={row}
					side="ask"
				/>
			))}
			{bidRows.map((row) => (
				<DepthRowLine
					key={row.label}
					maxVolume={maxVolume}
					row={row}
					side="bid"
				/>
			))}
		</div>
	);
}

function QuotePriceHeader({
	last,
	prevClose,
	changePct,
}: {
	last: number | null;
	prevClose: number | null;
	changePct: number | null;
}) {
	const priceColor = changeColor(changePct);
	const absChange =
		last !== null && prevClose !== null ? last - prevClose : null;
	return (
		<div className="flex items-baseline gap-3">
			<span
				className="font-bold text-3xl tabular-nums"
				style={priceColor ? { color: priceColor } : undefined}
			>
				{formatNum(last)}
			</span>
			<div className="flex flex-col gap-0.5">
				<ChangePct value={changePct} />
				<span
					className={cn(
						"text-xs tabular-nums",
						priceColor ? "" : "text-muted-foreground"
					)}
					style={priceColor ? { color: priceColor } : undefined}
				>
					{formatSignedNum(absChange)}
				</span>
			</div>
		</div>
	);
}

/** finance_quote → header (name/symbol/market badge), a large last price with
 * signed change, a StatGrid of the day's key figures, and a 盘口 depth
 * ladder. */
export function QuoteCard({ data }: { data: QuoteData }) {
	const askRows = toDepthRows(data.asks, "卖").reverse();
	const bidRows = toDepthRows(data.bids, "买");
	const maxVolume = maxDepthVolume([...askRows, ...bidRows]);

	return (
		<CardShell
			right={<Badge variant="outline">{marketLabel(data.market)}</Badge>}
			subtitle={data.name ? data.symbol : undefined}
			title={data.name || data.symbol}
		>
			<QuotePriceHeader
				changePct={data.changePct}
				last={data.last}
				prevClose={data.prevClose}
			/>
			<StatGrid
				items={[
					{ label: "今开", value: formatNum(data.open) },
					{ label: "最高", value: formatNum(data.high) },
					{ label: "最低", value: formatNum(data.low) },
					{ label: "昨收", value: formatNum(data.prevClose) },
					{ label: "成交量", value: formatCompact(data.volume) },
				]}
			/>
			<DepthLadder askRows={askRows} bidRows={bidRows} maxVolume={maxVolume} />
		</CardShell>
	);
}
