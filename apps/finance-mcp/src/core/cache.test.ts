import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMemoryCache, withCache } from "./cache";

interface CachesGlobal {
	caches?: {
		default: {
			match(req: Request): Promise<Response | undefined>;
			put(req: Request, res: Response): Promise<void>;
		};
	};
}

function installFakeCache(): Map<string, string> {
	const stored = new Map<string, string>();
	(globalThis as CachesGlobal).caches = {
		default: {
			match: (req: Request) => {
				const body = stored.get(req.url);
				return Promise.resolve(
					body === undefined ? undefined : new Response(body)
				);
			},
			put: async (req: Request, res: Response) => {
				stored.set(req.url, await res.text());
			},
		},
	};
	return stored;
}

describe("withCache (Workers caches.default)", () => {
	it("caches non-empty results", async () => {
		const stored = installFakeCache();
		try {
			expect(await withCache("k2", 60, async () => [1, 2])).toEqual([1, 2]);
			expect(stored.size).toBe(1);
		} finally {
			(globalThis as CachesGlobal).caches = undefined;
		}
	});

	it("does not cache null or empty-array results (transient failures)", async () => {
		const stored = installFakeCache();
		try {
			expect(await withCache("k3", 60, async () => null)).toBeNull();
			expect(await withCache("k4", 60, async () => [])).toEqual([]);
			expect(stored.size).toBe(0);
		} finally {
			(globalThis as CachesGlobal).caches = undefined;
		}
	});
});

// No `caches` global (Node / docker compose): the in-process TTL map takes over.
describe("withCache (Node in-process fallback)", () => {
	beforeEach(() => {
		clearMemoryCache();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("computes on first call and serves the cached value afterwards", async () => {
		const fn = vi.fn(async () => ({ v: 1 }));
		expect(await withCache("m1", 60, fn)).toEqual({ v: 1 });
		expect(await withCache("m1", 60, fn)).toEqual({ v: 1 });
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("recomputes after the TTL expires", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const fn = vi.fn(() => {
			calls += 1;
			return Promise.resolve({ v: calls });
		});
		expect(await withCache("m2", 10, fn)).toEqual({ v: 1 });
		// Still within the 10s TTL — served from cache.
		vi.advanceTimersByTime(9000);
		expect(await withCache("m2", 10, fn)).toEqual({ v: 1 });
		// Past the TTL — recomputed.
		vi.advanceTimersByTime(2000);
		expect(await withCache("m2", 10, fn)).toEqual({ v: 2 });
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("does not cache null or empty-array results (transient failures)", async () => {
		const nullFn = vi.fn(async () => null);
		expect(await withCache("m3", 60, nullFn)).toBeNull();
		expect(await withCache("m3", 60, nullFn)).toBeNull();
		expect(nullFn).toHaveBeenCalledTimes(2);

		const emptyFn = vi.fn(async () => [] as number[]);
		expect(await withCache("m4", 60, emptyFn)).toEqual([]);
		expect(await withCache("m4", 60, emptyFn)).toEqual([]);
		expect(emptyFn).toHaveBeenCalledTimes(2);
	});
});
