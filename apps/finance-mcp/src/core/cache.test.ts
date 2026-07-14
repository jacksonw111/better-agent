import { describe, expect, it, vi } from "vitest";
import { withCache } from "./cache";

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

describe("withCache", () => {
	it("falls through to fn when caches is unavailable (test env)", async () => {
		const fn = vi.fn(async () => ({ v: 1 }));
		const out = await withCache("k1", 60, fn);
		expect(out).toEqual({ v: 1 });
		expect(fn).toHaveBeenCalledTimes(1);
	});

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
