import { describe, expect, it } from "vitest";
import {
	buildDeferredBinding,
	DEFER_THRESHOLD,
	rankTools,
	SEARCH_TOOL_NAME,
	shouldDefer,
} from "./tool-search";
import type { ToolDef } from "./types";

const CTX = {
	abortSignal: new AbortController().signal,
	agentId: "a",
	callId: "c",
	messageId: "m",
	sessionId: "s",
} as const;

function def(name: string, description: string, defer = true): ToolDef {
	return {
		name,
		description,
		defer,
		parameters: { type: "object" },
		execute: () => Promise.resolve({ output: `ran ${name}` }),
	};
}

describe("rankTools", () => {
	it("ranks name matches above description matches", () => {
		const tools = [
			def("GMAIL_SEND_EMAIL", "Send an email via Gmail"),
			def("TWITTER_SEARCH", "Search posts. Can also find email addresses."),
		];
		const ranked = rankTools(tools, "send email");
		expect(ranked[0]?.name).toBe("GMAIL_SEND_EMAIL");
	});

	it("returns nothing for an unrelated query", () => {
		const tools = [def("GMAIL_SEND_EMAIL", "Send an email")];
		expect(rankTools(tools, "weather forecast")).toEqual([]);
	});

	it("matches Chinese queries against Chinese in descriptions", () => {
		const tools = [
			def("finance_quote", "股票实时行情报价 realtime stock quote"),
			def("finance_ipo", "新股申购日历 IPO calendar"),
		];
		const ranked = rankTools(tools, "股票行情数据查询");
		expect(ranked[0]?.name).toBe("finance_quote");
	});

	it("scores precise multi-char CJK terms above incidental single chars", () => {
		const tools = [
			def("finance_quote", "股票行情报价"),
			def("finance_index_weights", "指数成分股权重"),
		];
		// Both share the char 股, but only finance_quote carries the term 股票.
		const ranked = rankTools(tools, "股票行情");
		expect(ranked[0]?.name).toBe("finance_quote");
	});
});

describe("shouldDefer", () => {
	it("only defers past the threshold of defer-marked tools", () => {
		const many = Array.from({ length: DEFER_THRESHOLD + 1 }, (_, i) =>
			def(`TOOL_${i}`, "d")
		);
		expect(shouldDefer(many)).toBe(true);
		expect(shouldDefer(many.slice(1))).toBe(false);
		const nonDefer = many.map((d) => ({ ...d, defer: false }));
		expect(shouldDefer(nonDefer)).toBe(false);
	});
});

describe("buildDeferredBinding", () => {
	it("hides deferred tools until a search surfaces them", async () => {
		const defs = [
			def("ALWAYS_ON", "core tool", false),
			def("GMAIL_SEND_EMAIL", "Send an email via Gmail"),
			def("TWITTER_SEARCH", "Search tweets"),
		];
		const binding = buildDeferredBinding(defs);
		expect(binding.activeNames().sort()).toEqual([
			"ALWAYS_ON",
			SEARCH_TOOL_NAME,
		]);

		const search = binding.defs.find((d) => d.name === SEARCH_TOOL_NAME);
		const result = await search?.execute({ queries: ["send an email"] }, CTX);
		expect(result?.output).toContain("GMAIL_SEND_EMAIL");
		expect(binding.activeNames()).toContain("GMAIL_SEND_EMAIL");
		// Unrelated tools stay hidden.
		expect(binding.activeNames()).not.toContain("TWITTER_SEARCH");
	});

	it("merges multiple queries in one call, deduping repeats", async () => {
		const defs = [
			def("GMAIL_SEND_EMAIL", "Send an email via Gmail"),
			def("TWITTER_SEARCH", "Search tweets"),
		];
		const binding = buildDeferredBinding(defs);
		const search = binding.defs.find((d) => d.name === SEARCH_TOOL_NAME);
		const result = await search?.execute(
			{ queries: ["send email", "search tweets", "send email"] },
			CTX
		);
		expect(result?.output).toContain("GMAIL_SEND_EMAIL");
		expect(result?.output).toContain("TWITTER_SEARCH");
		expect(binding.activeNames()).toContain("GMAIL_SEND_EMAIL");
		expect(binding.activeNames()).toContain("TWITTER_SEARCH");
	});

	it("still accepts the legacy single-query shape", async () => {
		const binding = buildDeferredBinding([
			def("GMAIL_SEND_EMAIL", "Send an email"),
		]);
		const search = binding.defs.find((d) => d.name === SEARCH_TOOL_NAME);
		const result = await search?.execute({ query: "send email" }, CTX);
		expect(result?.output).toContain("GMAIL_SEND_EMAIL");
	});

	it("reports no matches without activating anything", async () => {
		const binding = buildDeferredBinding([def("GMAIL_SEND_EMAIL", "email")]);
		const search = binding.defs.find((d) => d.name === SEARCH_TOOL_NAME);
		const result = await search?.execute({ queries: ["zzz qqq"] }, CTX);
		expect(result?.output).toContain("No tools matched");
		expect(binding.activeNames()).toEqual([SEARCH_TOOL_NAME]);
	});
});
