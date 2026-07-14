import type { KeyMetricsData } from "./finance-schemas";
import { formatCompact, formatDate, formatNum } from "./format";
import { ChangePct, StatGrid, type StatGridItem } from "./primitives";
import { StatPanel } from "./stat-panel";
import type { StatPanelGroup } from "./stat-panel-types";

const LEAD_COLS = 2;
const VALUATION_COLS = 4;
const SCALE_COLS = 4;

function priceTone(n: number | null): StatGridItem["tone"] {
	if (n === null || Number.isNaN(n) || n === 0) {
		return "muted";
	}
	return n > 0 ? "up" : "down";
}

/** finance_key_metrics → StatPanel: 行情 (最新价/涨跌幅) and 估值 (every
 * PE/PB/PS/PCF/PEG multiple) always-visible, 规模 · 股本 (市值/股本 figures)
 * behind Expand — every label/formatter kept verbatim from the original
 * flat 12-item grid, just regrouped. */
export function KeyMetricsCard({ data }: { data: KeyMetricsData }) {
	const groups: StatPanelGroup[] = [
		{
			cols: LEAD_COLS,
			items: [
				{
					label: "最新价",
					tone: priceTone(data.changePct),
					value: formatNum(data.close),
				},
				{ label: "涨跌幅", value: <ChangePct value={data.changePct} /> },
			],
			label: "行情",
		},
		{
			cols: VALUATION_COLS,
			items: [
				{ label: "PE(TTM)", value: formatNum(data.peTtm) },
				{ label: "PE(静)", value: formatNum(data.peStatic) },
				{ label: "PB", value: formatNum(data.pb) },
				{ label: "PS", value: formatNum(data.ps) },
				{ label: "PCF", value: formatNum(data.pcf) },
				{ label: "PEG", value: formatNum(data.peg) },
			],
			label: "估值",
		},
	];
	const scaleItems: StatGridItem[] = [
		{ label: "总市值", value: formatCompact(data.marketCap, { cny: true }) },
		{
			label: "流通市值",
			value: formatCompact(data.floatMarketCap, { cny: true }),
		},
		{ label: "总股本", value: formatCompact(data.totalShares) },
		{ label: "流通股", value: formatCompact(data.floatShares) },
	];

	return (
		<StatPanel
			expandable={{
				content: <StatGrid cols={SCALE_COLS} items={scaleItems} />,
				label: "规模 · 股本",
			}}
			groups={groups}
			subtitle={formatDate(data.tradeDate)}
			title={data.symbol}
		/>
	);
}
