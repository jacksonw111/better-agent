import { expect, it } from "vitest";
import type { MessageUsage } from "../session/types";
import { priceUsage } from "./cost";

const baseUsage: MessageUsage = {
	inputTokens: 1_000_000,
	outputTokens: 1_000_000,
	totalTokens: null,
	reasoningTokens: null,
	cacheReadTokens: null,
	cacheWriteTokens: null,
	costCents: null,
};

it("prices input + output cost in USD", () => {
	// $3/M in, $15/M out → $3 + $15 = $18 (was 1800c)
	expect(
		priceUsage(baseUsage, { inputPricePerM: 3, outputPricePerM: 15 })
	).toEqual({ costUsd: 18, priced: true });
});

it("bills cache-read at 0.1x input and cache-write at 1.25x input", () => {
	const usage = {
		...baseUsage,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 1_000_000,
		cacheWriteTokens: 1_000_000,
	};
	// 1M*3*0.1 = $0.30 (read) + 1M*3*1.25 = $3.75 (write) = $4.05 (was 405c)
	expect(priceUsage(usage, { inputPricePerM: 3, outputPricePerM: 15 })).toEqual(
		{ costUsd: 4.05, priced: true }
	);
});

it("bills reasoning tokens at the output rate", () => {
	const usage = {
		...baseUsage,
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 1_000_000,
	};
	// 1M*15 = $15 (was 1500c)
	expect(priceUsage(usage, { inputPricePerM: 3, outputPricePerM: 15 })).toEqual(
		{ costUsd: 15, priced: true }
	);
});

it("returns unpriced when pricing is missing", () => {
	expect(
		priceUsage(baseUsage, { inputPricePerM: null, outputPricePerM: null })
	).toEqual({ costUsd: null, priced: false });
});

it("returns unpriced when only one price is null", () => {
	expect(
		priceUsage(baseUsage, { inputPricePerM: null, outputPricePerM: 15 })
	).toEqual({ costUsd: null, priced: false });
	expect(
		priceUsage(baseUsage, { inputPricePerM: 3, outputPricePerM: null })
	).toEqual({ costUsd: null, priced: false });
});
