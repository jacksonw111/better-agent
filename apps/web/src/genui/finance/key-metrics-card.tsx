import type { KeyMetricsData } from "./finance-schemas";
import { formatCompact, formatDate, formatNum } from "./format";
import {
	CardShell,
	ChangePct,
	StatGrid,
	type StatGridItem,
} from "./primitives";

const METRIC_COLS = 4;

function priceTone(n: number | null): StatGridItem["tone"] {
	if (n === null || Number.isNaN(n) || n === 0) {
		return "muted";
	}
	return n > 0 ? "up" : "down";
}

/** finance_key_metrics → a single valuation-snapshot card: 最新价/涨跌幅 plus
 * every multiple (市值/PE/PB/PS/PCF/PEG) and share-count figure EastMoney
 * reports, laid out as one dense StatGrid. */
export function KeyMetricsCard({ data }: { data: KeyMetricsData }) {
	return (
		<CardShell subtitle={formatDate(data.tradeDate)} title={data.symbol}>
			<StatGrid
				cols={METRIC_COLS}
				items={[
					{
						label: "最新价",
						tone: priceTone(data.changePct),
						value: formatNum(data.close),
					},
					{ label: "涨跌幅", value: <ChangePct value={data.changePct} /> },
					{
						label: "总市值",
						value: formatCompact(data.marketCap, { cny: true }),
					},
					{
						label: "流通市值",
						value: formatCompact(data.floatMarketCap, { cny: true }),
					},
					{ label: "PE(TTM)", value: formatNum(data.peTtm) },
					{ label: "PE(静)", value: formatNum(data.peStatic) },
					{ label: "PB", value: formatNum(data.pb) },
					{ label: "PS", value: formatNum(data.ps) },
					{ label: "PCF", value: formatNum(data.pcf) },
					{ label: "PEG", value: formatNum(data.peg) },
					{ label: "总股本", value: formatCompact(data.totalShares) },
					{ label: "流通股", value: formatCompact(data.floatShares) },
				]}
			/>
		</CardShell>
	);
}
