import { changeColor } from "./chart-theme";
import type { SectorRowData } from "./finance-schemas-fe6";
import { formatNum } from "./format";
import { CardShell, ChangePct } from "./primitives";
import { useRankListOrchestration } from "./rank-list";
import { RankListStrip } from "./rank-list-controls";
import type { RankListSortOption } from "./rank-list-types";

// finance_sector_list → 板块热力图, the Heatmap 2D variant of `RankList`
// (design doc §8.6 "Heatmap 变体(sector_list):2D 色块网格,cell hover 读值,
// So 按涨跌排色"). Reuses `useRankListOrchestration` verbatim for Sort — the
// same hook `RankList` itself calls — and swaps a grid-cell renderer in for
// `RankListRows`, exactly the separation rank-list-types.ts documents. No
// Filter dimension exists on `SectorRowData` (never invent one) and no
// Expand — hover/focus is the read-out interaction here, not drill-down.

const MAX_TILES = 40;
const MAX_INTENSITY_PCT = 5; // |changePct| at/above this saturates the tint
const MIN_ALPHA = 0.08;
const MAX_ALPHA = 0.55;
const ALPHA_DECIMALS = 2;
const HEX_RGB_LEN = 6;
const HEX_RADIX = 16;
const HEX_BYTE_LEN = 2;
const HEX_R_START = 0;
const HEX_G_START = HEX_R_START + HEX_BYTE_LEN;
const HEX_B_START = HEX_G_START + HEX_BYTE_LEN;
const HEX_B_END = HEX_B_START + HEX_BYTE_LEN;

const SORT_OPTIONS: RankListSortOption<SectorRowData>[] = [];

/** `#rrggbb` → `rgba(r, g, b, alpha)` — mirrors candlestick-canvas.tsx's
 * local helper of the same shape, deriving the tile's translucent fill from
 * the price axis's single-source hex (`changeColor`) instead of a second
 * hardcoded RGB literal (§11 色轴单一出口). */
function hexToRgba(hex: string, alpha: number): string {
	const clean = hex.replace("#", "").padEnd(HEX_RGB_LEN, "0");
	const r = Number.parseInt(clean.slice(HEX_R_START, HEX_G_START), HEX_RADIX);
	const g = Number.parseInt(clean.slice(HEX_G_START, HEX_B_START), HEX_RADIX);
	const b = Number.parseInt(clean.slice(HEX_B_START, HEX_B_END), HEX_RADIX);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Background tint for a sector tile: red for up, green for down (红涨绿跌
 * via `changeColor`), intensity proportional to |changePct| (clamped at
 * MAX_INTENSITY_PCT so a single outlier board doesn't wash out the rest of
 * the grid). `undefined` for zero/missing so the tile falls back to the
 * card's plain background. */
function tileBackground(changePct: number | null): string | undefined {
	const color = changeColor(changePct);
	if (color === null || changePct === null) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit undefined keeps eslint consistent-return happy alongside the string return below
		return undefined;
	}
	const clamped = Math.min(Math.abs(changePct), MAX_INTENSITY_PCT);
	const alpha =
		MIN_ALPHA + (clamped / MAX_INTENSITY_PCT) * (MAX_ALPHA - MIN_ALPHA);
	return hexToRgba(color, Number(alpha.toFixed(ALPHA_DECIMALS)));
}

/** One sector tile — tinted background + name + change%. Hover/focus lifts
 * the tile (scale + z-raise) and reveals its exact price/领涨股 figures,
 * which sit in a reserved, always-in-flow line at `opacity-0` so revealing
 * them never reflows the grid (§8.6 "cell hover 读值"). */
function SectorTile({ item }: { item: SectorRowData }) {
	return (
		<button
			className="group relative flex w-full flex-col gap-1 rounded-md p-2 text-left transition-transform duration-150 hover:z-10 hover:scale-105 focus:z-10 focus:scale-105 focus:outline-none"
			style={{ backgroundColor: tileBackground(item.changePct) }}
			type="button"
		>
			<span className="truncate font-medium text-xs">
				{item.name || item.code}
			</span>
			<ChangePct value={item.changePct} />
			<div className="flex flex-col gap-0.5 text-muted-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
				<span className="tabular-nums">{formatNum(item.price)}</span>
				{item.leadStockCode ? (
					<span className="flex items-center gap-1 truncate">
						领涨 {item.leadStockCode}
						<ChangePct value={item.leadStockChangePct} />
					</span>
				) : null}
			</div>
		</button>
	);
}

/** finance_sector_list → 板块热力图, ranked/tinted by change%, capped at
 * MAX_TILES — this renders inline in chat, not a full market map. */
export function SectorHeatmap({ items }: { items: SectorRowData[] }) {
	const visible = items.slice(0, MAX_TILES);
	const hiddenCount = items.length - visible.length;
	// Hook is called unconditionally (before the empty-state early return
	// below) — rules-of-hooks requires this even when `items` is empty, and
	// `useRankListOrchestration` tolerates an empty `items` array fine.
	const { rendered, sort, sortOptionIds, filter } = useRankListOrchestration({
		filterMode: "single",
		filters: [],
		items: visible,
		rankMetric: (item: SectorRowData) => item.changePct,
		sortOptions: SORT_OPTIONS,
	});

	if (items.length === 0) {
		return null;
	}

	return (
		<CardShell title="板块热力图">
			<RankListStrip
				filter={filter}
				filterMode="single"
				filters={[]}
				metricLabel="涨跌幅"
				sort={sort}
				sortOptionIds={sortOptionIds}
			/>
			<div className="@container">
				{/* Container-query columns key off the card width, not the viewport,
				    so a narrow chat column never packs 5 tiles into an illegible row
				    (see StatGrid's note in primitives.tsx). */}
				<div className="grid @lg:grid-cols-5 @sm:grid-cols-4 @xs:grid-cols-3 grid-cols-2 gap-2">
					{rendered.map((item) => (
						<SectorTile item={item} key={item.code} />
					))}
				</div>
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
