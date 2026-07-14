import { MAX_RENDERED_ITEMS } from "../registry/entry";
import type { NewsItemData, StockNewsItemData } from "./finance-schemas-fe8";
import { FeedMoreFooter, NewsFeed } from "./news-feed";
import type { FeedItem, NewsFeedFilter } from "./news-feed-types";

// finance_news (7x24 flash feed) and finance_stock_news (keyword/company
// search) both render through the shared `NewsFeed` archetype (design doc
// §8.10) — each item's shape is told apart by `id` (finance_news, no `url`)
// vs `url` (finance_stock_news, no `id`); see NewsItemSchema /
// StockNewsItemSchema.

export type NewsListItemData = NewsItemData | StockNewsItemData;

function isFlashNews(item: NewsListItemData): item is NewsItemData {
	return "id" in item;
}

function toFeedItem(item: NewsListItemData): FeedItem {
	if (isFlashNews(item)) {
		return {
			id: item.id,
			snippet: item.summary || undefined,
			time: item.time,
			title: item.title,
		};
	}
	return {
		id: item.url,
		snippet: item.snippet || undefined,
		source: item.source || undefined,
		time: item.date,
		title: item.title,
		url: item.url,
	};
}

/** finance_stock_news carries `source`; finance_news (flash, 7x24) has no
 * discrete field to filter by, so it gets no filter chips at all (mirrors the
 * DataTable rule: don't invent a filter field). */
function sourceFilters(items: NewsListItemData[]): NewsFeedFilter[] {
	const sources = new Set<string>();
	for (const item of items) {
		if (!isFlashNews(item) && item.source) {
			sources.add(item.source);
		}
	}
	return [...sources].map((source) => ({
		id: source,
		label: source,
		predicate: (feedItem) => feedItem.source === source,
	}));
}

/** finance_news / finance_stock_news → 新闻资讯, capped at MAX_RENDERED_ITEMS
 * — this renders inline in chat, not a full news feed. */
export function NewsList({ data }: { data: NewsListItemData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<NewsFeed
			filters={sourceFilters(visible)}
			footer={hiddenCount > 0 ? <FeedMoreFooter count={hiddenCount} /> : null}
			items={visible.map(toFeedItem)}
			title="新闻资讯"
		/>
	);
}
