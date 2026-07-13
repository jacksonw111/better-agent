import { PdfLink } from "@/components/pdf/pdf-link";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { ResearchReportData } from "./finance-schemas-fe8";
import { formatNum } from "./format";
import { FeedMoreFooter, NewsFeed } from "./news-feed";
import type { FeedItem, NewsFeedFilter } from "./news-feed-types";

// finance_research → 分析师研报, rendered through the shared `NewsFeed`
// archetype (design doc §8.10). ResearchReport carries no free-text summary
// and no rating field, so nothing sits behind Expand — the EPS/PE snapshot +
// `PdfLink` are always-visible `meta` content instead.

function EpsPeCell({
	label,
	eps,
	pe,
}: {
	label: string;
	eps: number | null;
	pe: number | null;
}) {
	return (
		<div className="flex flex-col items-center gap-0.5 rounded-md bg-muted/30 px-2 py-1">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="text-xs tabular-nums">
				EPS {formatNum(eps)} · PE {formatNum(pe)}
			</span>
		</div>
	);
}

function ResearchMeta({ item }: { item: ResearchReportData }) {
	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-3 gap-2">
				<EpsPeCell eps={item.epsY0} label="今年" pe={item.peY0} />
				<EpsPeCell eps={item.epsY1} label="明年" pe={item.peY1} />
				<EpsPeCell eps={item.epsY2} label="后年" pe={item.peY2} />
			</div>
			{item.pdfUrl ? (
				<PdfLink label="研报PDF" pdfUrl={item.pdfUrl} title={item.title} />
			) : null}
		</div>
	);
}

/** `org` + `date` is the natural identity for a research report, but two
 * reports from the same org on the same day (rare, but not impossible) would
 * collide — folding in the array index keeps every card key unique without
 * ever using the index alone. */
function researchKey(item: ResearchReportData, index: number): string {
	return `${item.org}-${item.date}-${index}`;
}

function toFeedItem(item: ResearchReportData, index: number): FeedItem {
	return {
		id: researchKey(item, index),
		meta: <ResearchMeta item={item} />,
		source: item.org || undefined,
		time: item.date,
		title: item.title,
	};
}

/** Filters by 机构 (`org`) — the only discrete field ResearchReport carries;
 * there's no rating to filter/badge by. */
function institutionFilters(items: ResearchReportData[]): NewsFeedFilter[] {
	const orgs = new Set<string>();
	for (const item of items) {
		if (item.org) {
			orgs.add(item.org);
		}
	}
	return [...orgs].map((org) => ({
		id: org,
		label: org,
		predicate: (feedItem) => feedItem.source === org,
	}));
}

/** finance_research → 分析师研报, capped at MAX_RENDERED_ITEMS — this renders
 * inline in chat, not a full research archive. */
export function ResearchList({ data }: { data: ResearchReportData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<NewsFeed
			filters={institutionFilters(visible)}
			footer={hiddenCount > 0 ? <FeedMoreFooter count={hiddenCount} /> : null}
			items={visible.map(toFeedItem)}
			title="分析师研报"
		/>
	);
}
