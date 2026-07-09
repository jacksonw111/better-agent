import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-9 slice: finance_prediction_markets. Split out of
// finance-renderers.test.ts (which is at the project's 300-line-per-file
// cap) — same pattern as finance-renderers-fe5.test.ts.

const PREDICTION_MARKET_FIXTURE = {
	endDate: "2026-11-03T00:00:00Z",
	id: "0x1234",
	liquidityUsd: 500_000,
	outcomes: [
		{ name: "Yes", probability: 0.62 },
		{ name: "No", probability: 0.38 },
	],
	question: "Will the Fed cut rates in September?",
	slug: "fed-cut-rates-september",
	volumeUsd: 12_500_000,
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_prediction_markets fixture", () => {
	expect(
		financeTool("finance_prediction_markets").parse([PREDICTION_MARKET_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_prediction_markets given a wrong shape", () => {
	expect(
		financeTool("finance_prediction_markets").parse([{ unrelated: "shape" }])
	).toBeNull();
});
