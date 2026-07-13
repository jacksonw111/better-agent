import type { ReactNode } from "react";

// Phase 3 Task 3 — shared types for the `NewsFeed` archetype (design doc
// §8.10: 标题 + 时间 + 来源 + 摘要 的时序流, contract F·So·E). The 4 finance
// tools it backs (news, stock_news, research, list_reports) each map their
// own row shape onto `FeedItem`; the archetype itself only ever sees this
// common shape after that.

export interface FeedItem {
	/** A small neutral categorical tag (e.g. 年报/中报). Never the price or
	 * sentiment color axis — none of this archetype's 4 tools carry a
	 * rating/sentiment field to color by. */
	badge?: string;
	/** Stable per-item identity for the sort/filter/expand hooks and React
	 * `key`s — callers already have a natural one (`id`, `url`, `artCode`, or
	 * a composite fallback for rows with no unique field of their own). */
	id: string;
	/** Always-visible extra content under the header line (e.g. an EPS/PE
	 * grid, a `PdfLink`) — not gated behind Expand. */
	meta?: ReactNode;
	/** Longer body revealed by Expand. Presence alone makes the row's Expand
	 * toggle appear — omit it for items with nothing to expand into. */
	snippet?: string;
	source?: string;
	/** Raw date/datetime string driving both the display label (via
	 * `formatDate`) and the time Sort — parsed with `Date.parse`, so either
	 * "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" source strings sort correctly. */
	time: string;
	title: string;
	/** Present only for items that link out to an original article — rendered
	 * `rel="noopener"` `target="_blank"`. PDFs go through the shared vault
	 * drawer (`PdfLink`, via `meta` below) instead of a bare href. */
	url?: string;
}

export interface NewsFeedFilter {
	id: string;
	label: string;
	predicate: (item: FeedItem) => boolean;
}

export interface NewsFeedProps {
	/** Multi-toggle filter chips (design doc §8.10 "F 来源/机构/评级/类型") —
	 * only ever supplied when the payload actually carries a discrete field to
	 * filter by; omitted entirely otherwise (mirrors the DataTable rule: don't
	 * invent a filter field). */
	filters?: NewsFeedFilter[];
	/** "+N more" style trailer rendered under the list, e.g. from a caller's
	 * own MAX_RENDERED_ITEMS cap. */
	footer?: ReactNode;
	items: FeedItem[];
	subtitle?: string;
	title: string;
}
