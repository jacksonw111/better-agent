import type { CommodityQuoteData } from "./finance-schemas";
import { formatNum } from "./format";
import { ChangePct } from "./primitives";

const MAX_COMMODITY_ITEMS = 30;

function CommodityCard({ item }: { item: CommodityQuoteData }) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
			<span className="truncate font-medium text-sm">
				{item.name || item.key}
			</span>
			<span className="font-semibold text-lg tabular-nums">
				{formatNum(item.last)}
			</span>
			<ChangePct value={item.changePct} />
		</div>
	);
}

/** finance_commodity → a small responsive grid of commodity cards. Caps at
 * MAX_COMMODITY_ITEMS — this renders inline in chat, not a full page. */
export function CommodityGrid({ items }: { items: CommodityQuoteData[] }) {
	if (items.length === 0) {
		return null;
	}
	const visible = items.slice(0, MAX_COMMODITY_ITEMS);
	const hiddenCount = items.length - visible.length;
	return (
		<div className="flex w-full flex-col gap-2">
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
				{visible.map((item) => (
					<CommodityCard item={item} key={item.key} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</div>
	);
}
