// Public entry point for @jacksonw111/finance-genui. Barrel files are banned
// elsewhere in this repo, but a published package needs a single, curated
// entry — keep this to real public API only.

// Styling primitives shared by the renderers.
export { Badge, badgeVariants } from "./components/badge";
export { cn } from "./lib/cn";
// PDF affordance injection: supply a host-app PdfLink (e.g. one that opens a
// drawer) via PdfLinkProvider; without one, cards render a plain external link.
export {
	PdfLink,
	type PdfLinkComponent,
	type PdfLinkProps,
	PdfLinkProvider,
} from "./pdf-link";
// Registry helpers, so consumers can build their own tool renderers the same
// way the finance ones are built.
export {
	entry,
	listEntry,
	MAX_RENDERED_ITEMS,
	type ToolResultRenderer,
} from "./registry/entry";
export { unwrapToolResult } from "./registry/envelope";
// Archetype components — the reusable layouts the finance cards are built on.
export { CalendarList } from "./renderers/calendar-list";
// Low-level building blocks: layout primitives, number/date formatting, and
// the chart theme tokens.
export * from "./renderers/chart-theme";
export { DataTable } from "./renderers/data-table";
export { EventCalendar } from "./renderers/event-calendar";
// The finance tool-result registry: tool name → { parse, render }. Spread this
// into a host app's own registry to render finance MCP tool results.
export { FINANCE_RENDERERS } from "./renderers/finance-renderers";
// Core finance data schemas (quotes, candles, fundamentals, …).
export * from "./renderers/finance-schemas";
export * from "./renderers/format";
export { NewsFeed } from "./renderers/news-feed";
export {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
	StatGrid,
	type StatGridItem,
} from "./renderers/primitives";
export { RankList } from "./renderers/rank-list";
export { SectorHeatmap } from "./renderers/sector-heatmap";
export { Segmented } from "./renderers/segmented";
export { Sparkline } from "./renderers/sparkline";
export { StatPanel } from "./renderers/stat-panel";
