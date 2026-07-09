import type { IndexQuoteData } from "./finance-schemas";
import { formatNum } from "./format";
import { ChangePct } from "./primitives";

const MAX_INDEX_ITEMS = 30;

function IndexCard({ item }: { item: IndexQuoteData }) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
			<span className="truncate font-medium text-sm">
				{item.name || item.code}
			</span>
			<span className="font-semibold text-lg tabular-nums">
				{formatNum(item.last)}
			</span>
			<ChangePct value={item.changePct} />
		</div>
	);
}

interface RegionGroup {
	items: IndexQuoteData[];
	region: string;
}

function groupByRegion(items: IndexQuoteData[]): RegionGroup[] {
	const order: string[] = [];
	const byRegion = new Map<string, IndexQuoteData[]>();
	for (const item of items) {
		const region = item.region || "指数";
		const bucket = byRegion.get(region);
		if (bucket) {
			bucket.push(item);
		} else {
			byRegion.set(region, [item]);
			order.push(region);
		}
	}
	return order.map((region) => ({
		items: byRegion.get(region) ?? [],
		region,
	}));
}

/** finance_index_quote → a responsive grid of compact index cards, grouped
 * subtly by region. Caps at MAX_INDEX_ITEMS — this renders inline in chat,
 * not a full watchlist page. */
export function IndexGrid({ items }: { items: IndexQuoteData[] }) {
	if (items.length === 0) {
		return null;
	}
	const visible = items.slice(0, MAX_INDEX_ITEMS);
	const hiddenCount = items.length - visible.length;
	const groups = groupByRegion(visible);
	return (
		<div className="flex w-full flex-col gap-3">
			{groups.map((group) => (
				<div className="flex flex-col gap-1.5" key={group.region}>
					<span className="text-muted-foreground text-xs uppercase tracking-wide">
						{group.region}
					</span>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
						{group.items.map((item) => (
							<IndexCard item={item} key={item.code} />
						))}
					</div>
				</div>
			))}
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</div>
	);
}
