import type { IndexQuoteData } from "./finance-schemas";
import { formatNum } from "./format";
import type { StatGridItem } from "./primitives";
import { QuoteGrid } from "./quote-grid";
import type { QuoteTileData } from "./quote-tile";

function toTile(item: IndexQuoteData): QuoteTileData {
	const expandItems: StatGridItem[] = [
		{ label: "最高", value: formatNum(item.high) },
		{ label: "最低", value: formatNum(item.low) },
		{ label: "昨收", value: formatNum(item.prevClose) },
	];
	return {
		changePct: item.changePct,
		expandItems,
		id: item.code,
		last: item.last,
		meta: item.region || undefined,
		name: item.name || item.code,
	};
}

/** finance_index_quote → QuoteGrid tiles: name/region + last + change, with
 * high/low/prevClose on expand. */
export function IndexGrid({ items }: { items: IndexQuoteData[] }) {
	return <QuoteGrid items={items.map(toTile)} />;
}
