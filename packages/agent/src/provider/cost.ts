import type { MessageUsage } from "../session/types";

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;
const TOKENS_PER_MILLION = 1_000_000;

interface Pricing {
	inputPricePerM: number | null;
	outputPricePerM: number | null;
}

/** Shared per-token dollar math. Returns null when pricing is unknown (either
 * price missing). `priceUsage` wraps it with the `priced` flag; the legacy
 * cents form is derived downstream from its USD result. */
function computeDollars(usage: MessageUsage, pricing: Pricing): number | null {
	if (pricing.inputPricePerM === null || pricing.outputPricePerM === null) {
		return null;
	}
	const inPrice = pricing.inputPricePerM;
	const outPrice = pricing.outputPricePerM;
	return (
		((usage.inputTokens ?? 0) * inPrice +
			(usage.outputTokens ?? 0) * outPrice +
			(usage.cacheReadTokens ?? 0) * inPrice * CACHE_READ_MULTIPLIER +
			(usage.cacheWriteTokens ?? 0) * inPrice * CACHE_WRITE_MULTIPLIER +
			(usage.reasoningTokens ?? 0) * outPrice) /
		TOKENS_PER_MILLION
	);
}

/** USD cost for `usage` under `pricing`, plus whether the cost is actually
 * known. `priced: false` (and `costUsd: null`) when either per-token price is
 * unset for the model. */
export function priceUsage(
	usage: MessageUsage,
	pricing: Pricing
): { costUsd: number | null; priced: boolean } {
	const dollars = computeDollars(usage, pricing);
	if (dollars === null) {
		return { costUsd: null, priced: false };
	}
	return { costUsd: dollars, priced: true };
}
