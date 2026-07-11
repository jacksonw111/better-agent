import { expect, it, vi } from "vitest";
import type { QuotaSnapshot } from "../types";
import { createQuotaCache } from "./quota-cache";

function snapshot(fetchedAt: string): QuotaSnapshot {
	return { provider: "codex", windows: [], fetchedAt };
}

it("caches a successful fetch and skips a second fetch within the TTL", async () => {
	let now = 0;
	const fetcher = vi.fn(() => Promise.resolve(snapshot("t1")));
	const cache = createQuotaCache(fetcher, { now: () => now, ttlMs: 1000 });

	expect(await cache.get()).toEqual(snapshot("t1"));
	now += 500;
	expect(await cache.get()).toEqual(snapshot("t1"));
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("re-fetches once the TTL has elapsed", async () => {
	let now = 0;
	let call = 0;
	const fetcher = vi.fn(() => {
		call += 1;
		return Promise.resolve(snapshot(`t${call}`));
	});
	const cache = createQuotaCache(fetcher, { now: () => now, ttlMs: 1000 });

	expect(await cache.get()).toEqual(snapshot("t1"));
	now += 1500;
	expect(await cache.get()).toEqual(snapshot("t2"));
	expect(fetcher).toHaveBeenCalledTimes(2);
});

it("dedupes concurrent get() calls into a single in-flight fetch", async () => {
	const fetcher = vi.fn(
		() =>
			new Promise<QuotaSnapshot>((resolve) => {
				setTimeout(() => resolve(snapshot("t1")), 10);
			})
	);
	const cache = createQuotaCache(fetcher);

	const [a, b] = await Promise.all([cache.get(), cache.get()]);
	expect(a).toEqual(snapshot("t1"));
	expect(b).toEqual(snapshot("t1"));
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("starts a fresh fetch after a prior in-flight fetch has settled", async () => {
	let call = 0;
	const fetcher = vi.fn(() => {
		call += 1;
		return Promise.resolve(snapshot(`t${call}`));
	});
	// TTL 0 so the second get() can't be served from cache — it must go
	// through the "start a fresh fetch" branch, not the dedupe branch.
	const cache = createQuotaCache(fetcher, { ttlMs: 0 });

	expect(await cache.get()).toEqual(snapshot("t1"));
	expect(await cache.get()).toEqual(snapshot("t2"));
	expect(fetcher).toHaveBeenCalledTimes(2);
});
