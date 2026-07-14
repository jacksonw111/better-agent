import type { CommodityQuoteData } from "./finance-schemas";
import { formatDate, formatNum } from "./format";
import type { StatGridItem } from "./primitives";
import { QuoteGrid } from "./quote-grid";
import type { QuoteTileData } from "./quote-tile";

function toTile(item: CommodityQuoteData): QuoteTileData {
	const expandItems: StatGridItem[] = [
		{ label: "最高", value: formatNum(item.high) },
		{ label: "最低", value: formatNum(item.low) },
		{ label: "昨收", value: formatNum(item.prevClose) },
		{ label: "时间", value: formatDate(item.time) },
	];
	return {
		changePct: item.changePct,
		expandItems,
		id: item.key,
		last: item.last,
		name: item.name || item.key,
	};
}

/** finance_commodity → QuoteGrid tiles: name + last + change, with
 * high/low/prevClose/time on expand. */
export function CommodityGrid({ items }: { items: CommodityQuoteData[] }) {
	return <QuoteGrid items={items.map(toTile)} />;
}
