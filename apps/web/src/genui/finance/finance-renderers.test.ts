import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

const INDEX_FIXTURE = {
	changePct: 0.42,
	code: "000001",
	high: 3210.5,
	last: 3200.12,
	low: 3180.3,
	name: "上证指数",
	prevClose: 3186.7,
	region: "CN",
};

const COMMODITY_FIXTURE = {
	changePct: -1.1,
	high: 2415.0,
	key: "XAU",
	last: 2400.5,
	low: 2390.0,
	name: "黄金",
	prevClose: 2427.2,
	time: "2026-07-08T09:30:00.000Z",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_index_quote fixture", () => {
	expect(
		financeTool("finance_index_quote").parse([INDEX_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_index_quote given a wrong shape", () => {
	expect(
		financeTool("finance_index_quote").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_commodity fixture", () => {
	expect(
		financeTool("finance_commodity").parse([COMMODITY_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_commodity given a wrong shape", () => {
	expect(
		financeTool("finance_commodity").parse([{ unrelated: "shape" }])
	).toBeNull();
});
