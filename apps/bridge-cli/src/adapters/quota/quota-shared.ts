// Small pieces shared by codex-quota.ts and claude-quota.ts — split out so
// neither fetcher file (nor this one) grows past the repo's 300-line file
// cap. Nothing here is provider-specific.

import type { QuotaSnapshot } from "../types";

/** Builds the fail-open "couldn't get quota" snapshot every fetcher returns
 * instead of throwing — see `QuotaSnapshot`'s own doc comment in
 * `../types.ts` for the fail-open contract this exists to uphold. */
export function unavailableQuota(
	provider: string,
	fetchedAt: string,
	unavailableReason: string
): QuotaSnapshot {
	return { provider, windows: [], fetchedAt, unavailableReason };
}

/** `fetch`, aborted after `timeoutMs` — the per-provider fetchers' own
 * network-level timeout (the brief's "HTTP error/5s timeout"), independent
 * of (and tighter than) the `QuotaCache`/`withTimeout` race the adapters'
 * `getStatus` wraps around the whole cache lookup. */
export async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/** Resolves to `fallback` if `promise` hasn't settled within `ms` — used by
 * `claude-code-status.ts`/`codex-status.ts` to bound how long a `getStatus`
 * snapshot waits on the (already internally-timed-out) quota cache lookup,
 * as a second, independent safety valve. Never rejects: a rejected `promise`
 * also resolves to `fallback`, matching every quota fetcher's own fail-open
 * contract. */
export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	fallback: T
): Promise<T> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(fallback), ms);
		promise
			.then((value) => {
				clearTimeout(timer);
				resolve(value);
			})
			.catch(() => {
				clearTimeout(timer);
				resolve(fallback);
			});
	});
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}
