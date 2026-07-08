import { describe, expect, it, vi } from "vitest";
import { withCache } from "./cache";

describe("withCache", () => {
	it("falls through to fn when caches is unavailable (test env)", async () => {
		const fn = vi.fn(async () => ({ v: 1 }));
		const out = await withCache("k1", 60, fn);
		expect(out).toEqual({ v: 1 });
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
