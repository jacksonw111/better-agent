import { cn } from "@better-agent/ui/lib/utils";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { NewsItemData, StockNewsItemData } from "./finance-schemas-fe8";
import { formatDate } from "./format";
import { CardShell } from "./primitives";

// finance_news (7x24 flash feed) and finance_stock_news (keyword/company
// search) both render as a vertical news list through this one component —
// each item's shape is told apart by `id` (finance_news, no `url`) vs `url`
// (finance_stock_news, no `id`); see NewsItemSchema / StockNewsItemSchema.

export type NewsListItemData = NewsItemData | StockNewsItemData;

function isFlashNews(item: NewsListItemData): item is NewsItemData {
	return "id" in item;
}

function newsRowKey(item: NewsListItemData): string {
	return isFlashNews(item) ? item.id : item.url;
}

const NEWS_ROW_CLASS = "flex flex-col gap-1 pb-2 last:pb-0";

function NewsRowBody({ item }: { item: NewsListItemData }) {
	const body = isFlashNews(item) ? item.summary : item.snippet;
	const timeLabel = formatDate(isFlashNews(item) ? item.time : item.date);
	const footer =
		!isFlashNews(item) && item.source
			? `${timeLabel} · ${item.source}`
			: timeLabel;
	return (
		<>
			<span className="font-medium text-sm">{item.title || "—"}</span>
			{body ? (
				<p className="line-clamp-2 text-muted-foreground text-xs">{body}</p>
			) : null}
			<span className="text-muted-foreground text-xs">{footer}</span>
		</>
	);
}

// A news item with a source URL (finance_stock_news) makes the whole card a
// tap target that opens the original article in a new tab; flash items
// (finance_news, no URL) stay static.
function NewsRow({ item }: { item: NewsListItemData }) {
	if (!isFlashNews(item) && item.url) {
		return (
			<a
				className={cn(
					NEWS_ROW_CLASS,
					"-mx-2 rounded-md px-2 transition-colors hover:bg-muted/50"
				)}
				href={item.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				<NewsRowBody item={item} />
			</a>
		);
	}
	return (
		<div className={NEWS_ROW_CLASS}>
			<NewsRowBody item={item} />
		</div>
	);
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
		<CardShell title="新闻资讯">
			<div className="flex flex-col gap-2">
				{visible.map((item) => (
					<NewsRow item={item} key={newsRowKey(item)} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
