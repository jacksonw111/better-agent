import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import mockData from "@/finance-genui-mock.json";
import { renderToolResult } from "@/genui/tool-renderers";

// THROWAWAY regression surface for the finance-genui rewrite — visit
// /finance-genui-preview to eyeball every finance tool's rendered component in
// one narrow (chat-bubble width) column, so mobile/layout regressions are easy
// to spot. The data in finance-genui-mock.json is REAL output captured from the
// deployed finance-mcp tools (not fabricated), trimmed to a few rows each.
// Delete this file + finance-genui-mock.json when done. Grouped by archetype so
// a scan follows the design doc's structure.

const mock = mockData as Record<string, unknown>;

const GROUPS: { group: string; tools: string[] }[] = [
	{
		group: "QuoteHeadline / QuoteGrid",
		tools: ["finance_quote", "finance_index_quote", "finance_commodity"],
	},
	{ group: "PriceChart", tools: ["finance_kline"] },
	{
		group: "DataTable",
		tools: [
			"finance_financial_statements",
			"finance_financial_indicators",
			"finance_dividends",
			"finance_earnings_forecast",
			"finance_top_holders",
			"finance_block_trades",
			"finance_insider_trades",
			"finance_convertible_bonds",
			"finance_lockup",
			"finance_suspension",
			"finance_ipo",
			"finance_earnings_preannounce",
		],
	},
	{ group: "BarSeries", tools: ["finance_money_flow", "finance_hsgt_flow"] },
	{
		group: "LineSeries",
		tools: ["finance_holder_count", "finance_margin", "finance_yield_curve"],
	},
	{
		group: "RankList / Heatmap",
		tools: [
			"finance_cn_hot",
			"finance_etf_list",
			"finance_sector_constituents",
			"finance_search",
			"finance_sentiment_trending",
			"finance_index_weights",
			"finance_sentiment_compare",
			"finance_sector_list",
		],
	},
	{
		group: "NewsFeed",
		tools: [
			"finance_news",
			"finance_stock_news",
			"finance_research",
			"finance_list_reports",
		],
	},
	{
		group: "Calendar",
		tools: [
			"finance_earnings_calendar",
			"finance_economic_calendar",
			"finance_central_bank",
		],
	},
	{
		group: "StatPanel",
		tools: [
			"finance_key_metrics",
			"finance_company_profile",
			"finance_technical",
			"finance_macro_cn",
			"finance_macro_us",
			"finance_sentiment_market",
			"finance_sentiment_ticker",
		],
	},
	{
		group: "OddsBars / SignalCard",
		tools: ["finance_prediction_markets", "finance_divergence"],
	},
	{
		group: "LadderTable",
		tools: ["finance_option_chain", "finance_dragon_tiger"],
	},
];

function emptyNote(data: unknown): string {
	if (data === undefined) {
		return "mock 无此工具";
	}
	if (Array.isArray(data) && data.length === 0) {
		return "工具返回空数据";
	}
	return "无渲染器 / schema 不匹配";
}

function ToolCard({ name }: { name: string }) {
	const data = mock[name];
	const node = data === undefined ? null : renderToolResult(name, data);
	return (
		<section className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<code className="font-medium text-muted-foreground text-xs">
					{name}
				</code>
				{node ? null : (
					<span className="text-amber-600 text-xs">{emptyNote(data)}</span>
				)}
			</div>
			{node ?? (
				<div className="rounded-md bg-muted/30 p-3 text-muted-foreground text-xs">
					—
				</div>
			)}
		</section>
	);
}

function PreviewHeader() {
	return (
		<header className="flex flex-col gap-1 border-border/40 border-b pb-3">
			<h1 className="font-semibold text-base">Finance genui · 组件回归</h1>
			<p className="text-muted-foreground text-xs">
				真实 finance-mcp 数据 · 窄列 = 聊天气泡宽度。缩放浏览器 /
				开设备模式测更窄的 mobile 宽度。用完删除本路由与
				finance-genui-mock.json。
			</p>
		</header>
	);
}

function PreviewPage() {
	// Finance renderers use motion / recharts / lightweight-charts (browser-only);
	// render only after hydration so SSR never touches window/chart engines.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div className="p-6 text-muted-foreground text-sm">加载组件预览…</div>
		);
	}

	return (
		<div className="min-h-dvh bg-background py-6">
			<div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4">
				<PreviewHeader />
				{GROUPS.map((g) => (
					<div className="flex flex-col gap-4" key={g.group}>
						<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							{g.group}
						</h2>
						{g.tools.map((t) => (
							<ToolCard key={t} name={t} />
						))}
					</div>
				))}
			</div>
		</div>
	);
}

export const Route = createFileRoute("/finance-genui-preview")({
	component: PreviewPage,
});
