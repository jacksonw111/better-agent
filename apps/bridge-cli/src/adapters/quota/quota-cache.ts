// R4-T1: a tiny TTL + in-flight-dedupe cache in front of each provider's
// quota fetcher (codex-quota.ts/claude-quota.ts) — quota barely changes
// between a session's successive `getStatus` polls, and the underlying fetch
// is a real network round trip, so re-fetching on every poll would be both
// wasteful and (per the brief's fail-open discipline) a needless extra
// chance to add latency to the snapshot. One cache instance per provider,
// held at module scope in claude-code-status.ts/codex-status.ts so it
// outlives any single session within the CLI process.

import type { QuotaSnapshot } from "../types";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface QuotaCache {
	get(): Promise<QuotaSnapshot>;
}

interface QuotaCacheOptions {
	now?: () => number;
	ttlMs?: number;
}

/**
 * Wraps `fetcher` with a `ttlMs` (default 5min) TTL cache: a `get()` call
 * within the TTL of the last successful fetch returns the cached snapshot
 * synchronously-resolved, no re-fetch. A `get()` call after the TTL expires
 * (or before anything's ever been fetched) starts a fresh fetch — but if one
 * is already in flight (two `getStatus` calls racing in before the first
 * resolves), every caller shares that SAME in-flight promise rather than
 * firing a second redundant request.
 */
export function createQuotaCache(
	fetcher: () => Promise<QuotaSnapshot>,
	options: QuotaCacheOptions = {}
): QuotaCache {
	const { now = Date.now, ttlMs = DEFAULT_TTL_MS } = options;
	let cached: { at: number; snapshot: QuotaSnapshot } | undefined;
	let inFlight: Promise<QuotaSnapshot> | undefined;

	return {
		get(): Promise<QuotaSnapshot> {
			if (cached && now() - cached.at < ttlMs) {
				return Promise.resolve(cached.snapshot);
			}
			if (inFlight) {
				return inFlight;
			}
			inFlight = fetcher()
				.then((snapshot) => {
					cached = { snapshot, at: now() };
					return snapshot;
				})
				.finally(() => {
					inFlight = undefined;
				});
			return inFlight;
		},
	};
}
