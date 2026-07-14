import { PdfLink } from "../pdf-link";
import { MAX_RENDERED_ITEMS } from "../registry/entry";
import type { ReportData } from "./finance-schemas-fe8";
import { FeedMoreFooter, NewsFeed } from "./news-feed";
import type { FeedItem, NewsFeedFilter } from "./news-feed-types";

// finance_list_reports → 定期报告, rendered through the shared `NewsFeed`
// archetype (design doc §8.10). No free-text body exists to expand into —
// the report-type tag is the row's `badge`, and `PdfLink` is always-visible
// `meta` content.

const REPORT_TYPE_LABEL: Record<string, string> = {
	annual: "年报",
	h1: "中报",
	q1: "一季报",
	q3: "三季报",
};

function reportTypeLabel(reportType: string): string {
	return REPORT_TYPE_LABEL[reportType] ?? (reportType || "—");
}

function toFeedItem(item: ReportData): FeedItem {
	return {
		badge: reportTypeLabel(item.reportType),
		id: item.artCode,
		meta: item.pdfUrl ? (
			<PdfLink label="PDF" pdfUrl={item.pdfUrl} title={item.title} />
		) : undefined,
		time: item.noticeDate,
		title: item.title,
	};
}

/** Filters by 报告类型 (annual/H1/Q1/Q3) — the row's `badge` field doubles as
 * the filter predicate's match target since both are derived from the same
 * label lookup. */
function typeFilters(items: ReportData[]): NewsFeedFilter[] {
	const types = new Set<string>();
	for (const item of items) {
		if (item.reportType) {
			types.add(item.reportType);
		}
	}
	return [...types].map((reportType) => {
		const label = reportTypeLabel(reportType);
		return {
			id: reportType,
			label,
			predicate: (feedItem) => feedItem.badge === label,
		};
	});
}

/** finance_list_reports → 定期报告 (annual / H1 / Q1 / Q3), newest
 * `noticeDate` first (NewsFeed's default time Sort), capped at
 * MAX_RENDERED_ITEMS. */
export function ReportsList({ data }: { data: ReportData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<NewsFeed
			filters={typeFilters(visible)}
			footer={hiddenCount > 0 ? <FeedMoreFooter count={hiddenCount} /> : null}
			items={visible.map(toFeedItem)}
			title="定期报告"
		/>
	);
}
