import type { SectorRowData } from "./finance-schemas-fe6";
import { changeColor } from "./format";
import { CardShell, ChangePct } from "./primitives";

const MAX_TILES = 40;
const MAX_INTENSITY_PCT = 5; // |changePct| at/above this saturates the tint
const MIN_ALPHA = 0.08;
const MAX_ALPHA = 0.55;
const UP_RGB = "239, 68, 68";
const DOWN_RGB = "22, 163, 74";
const ALPHA_DECIMALS = 2;

/** Background tint for a sector tile: red for up, green for down (红涨绿跌),
 * intensity proportional to |changePct| (clamped at MAX_INTENSITY_PCT so a
 * single outlier board doesn't wash out the rest of the grid). `undefined`
 * for zero/missing so the tile falls back to the card's plain background. */
function tileBackground(changePct: number | null): string | undefined {
	if (changePct === null || !changeColor(changePct)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit undefined keeps eslint consistent-return happy alongside the string return below
		return undefined;
	}
	const clamped = Math.min(Math.abs(changePct), MAX_INTENSITY_PCT);
	const alpha =
		MIN_ALPHA + (clamped / MAX_INTENSITY_PCT) * (MAX_ALPHA - MIN_ALPHA);
	const rgb = changePct > 0 ? UP_RGB : DOWN_RGB;
	return `rgba(${rgb}, ${alpha.toFixed(ALPHA_DECIMALS)})`;
}

function SectorTile({ item }: { item: SectorRowData }) {
	return (
		<div
			className="flex flex-col gap-1 rounded-md p-2"
			style={{ backgroundColor: tileBackground(item.changePct) }}
		>
			<span className="truncate font-medium text-xs">
				{item.name || item.code}
			</span>
			<ChangePct value={item.changePct} />
		</div>
	);
}

/** finance_sector_list → a responsive tinted-tile "heatmap" of boards, one
 * tile per sector, capped at MAX_TILES — this renders inline in chat, not a
 * full market map. */
export function SectorHeatmap({ items }: { items: SectorRowData[] }) {
	if (items.length === 0) {
		return null;
	}
	const visible = items.slice(0, MAX_TILES);
	const hiddenCount = items.length - visible.length;
	return (
		<CardShell title="板块">
			<div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
				{visible.map((item) => (
					<SectorTile item={item} key={item.code} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
