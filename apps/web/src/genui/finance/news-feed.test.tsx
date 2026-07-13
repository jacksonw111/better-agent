// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { NewsFeed } from "./news-feed";
import type { FeedItem, NewsFeedFilter } from "./news-feed-types";

// Render-level tests for the `NewsFeed` archetype (design doc §8.10, contract
// F·So·E). jsdom's global test-setup pins `prefers-reduced-motion: reduce`
// (see src/test-setup.ts), so entrance/expand animations settle synchronously
// under these assertions. Follows data-table.test.tsx's `within(container)`
// convention (no jest-dom matchers configured).

const ITEMS: FeedItem[] = [
	{
		id: "a",
		snippet: "老新闻的详细摘要内容。",
		source: "东方财富",
		time: "2026-07-01",
		title: "老新闻",
	},
	{
		id: "b",
		snippet: "新新闻的详细摘要内容。",
		source: "新浪财经",
		time: "2026-07-10",
		title: "新新闻",
		url: "https://example.com/b",
	},
	{
		id: "c",
		source: "东方财富",
		time: "2026-07-05",
		title: "无摘要新闻",
	},
];

const FILTERS: NewsFeedFilter[] = [
	{
		id: "东方财富",
		label: "东方财富",
		predicate: (item) => item.source === "东方财富",
	},
	{
		id: "新浪财经",
		label: "新浪财经",
		predicate: (item) => item.source === "新浪财经",
	},
];

function renderFeed(overrides: Partial<Parameters<typeof NewsFeed>[0]> = {}) {
	return render(
		<NewsFeed filters={FILTERS} items={ITEMS} title="新闻资讯" {...overrides} />
	);
}

/** Document-order comparison so the Sort test asserts actual row order
 * without relying on any test-only markup in the production component. */
function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition returns a bitmask; testing it against DOCUMENT_POSITION_FOLLOWING is the standard DOM idiom, not an accidental `&&` typo.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

it("renders every item's title, formatted time, and source", () => {
	const { container } = renderFeed();
	const scope = within(container);
	expect(scope.getByText("老新闻")).toBeDefined();
	expect(scope.getByText("新新闻")).toBeDefined();
	expect(scope.getByText("无摘要新闻")).toBeDefined();
	expect(scope.getByText("2026-07-01 · 东方财富")).toBeDefined();
});

it("defaults to newest-first and reorders when Sort is toggled", () => {
	const { container } = renderFeed();
	const scope = within(container);
	const newestMeta = () => scope.getByText("2026-07-10 · 新浪财经");
	const oldestMeta = () => scope.getByText("2026-07-01 · 东方财富");

	expect(isBefore(newestMeta(), oldestMeta())).toBe(true); // newest-first default

	fireEvent.click(scope.getByRole("button", { name: "最早" }));
	expect(isBefore(oldestMeta(), newestMeta())).toBe(true); // oldest-first now
});

it("narrows the feed when a filter chip is toggled", () => {
	const { container } = renderFeed();
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "新浪财经" }));
	expect(scope.getByText("新新闻")).toBeDefined();
	expect(scope.queryByText("老新闻")).toBeNull();
	expect(scope.queryByText("无摘要新闻")).toBeNull();
});

const ITEMS_WITH_SNIPPETS = 2; // items a and b carry a snippet; c doesn't

it("expands a row to reveal its snippet, and offers no toggle when there is none", () => {
	const { container } = renderFeed();
	const scope = within(container);
	expect(scope.queryByText("老新闻的详细摘要内容。")).toBeNull();

	const toggles = scope.getAllByRole("button", { name: "展开摘要" });
	expect(toggles).toHaveLength(ITEMS_WITH_SNIPPETS);
	fireEvent.click(toggles[0]);
	expect(scope.getByRole("button", { name: "收起摘要" })).toBeDefined();
});

it("renders a linked item's title as rel=noopener target=_blank", () => {
	const { container } = renderFeed();
	const link = within(container).getByText("新新闻").closest("a");
	expect(link).not.toBeNull();
	expect(link?.getAttribute("href")).toBe("https://example.com/b");
	expect(link?.getAttribute("rel")).toContain("noopener");
	expect(link?.getAttribute("target")).toBe("_blank");
});

it("renders no filter chips when the caller supplies none", () => {
	const { container } = renderFeed({ filters: undefined });
	expect(
		within(container).queryByRole("button", { name: "东方财富" })
	).toBeNull();
	// Sort still renders — every feed has a time dimension.
	expect(within(container).getByRole("button", { name: "最新" })).toBeDefined();
});
