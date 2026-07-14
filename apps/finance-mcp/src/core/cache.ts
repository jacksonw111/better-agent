interface CachesLike {
	default: {
		match(req: Request): Promise<Response | undefined>;
		put(req: Request, res: Response): Promise<void>;
	};
}

function cacheStore(): CachesLike["default"] | null {
	const c = (globalThis as unknown as { caches?: CachesLike }).caches;
	return c?.default ?? null;
}

// Upstream connectors degrade to null/[] on failure; caching those would
// pin a transient outage for the whole TTL (the "tool suddenly returns no
// data" failure mode). Legitimately-empty results just refetch — cheap.
function isEmptyResult(value: unknown): boolean {
	if (value === null || value === undefined) {
		return true;
	}
	return Array.isArray(value) && value.length === 0;
}

export async function withCache<T>(
	key: string,
	ttlSeconds: number,
	fn: () => Promise<T>
): Promise<T> {
	const store = cacheStore();
	if (!store) {
		return fn();
	}
	const req = new Request(`https://cache.local/${encodeURIComponent(key)}`);
	const hit = await store.match(req);
	if (hit) {
		return (await hit.json()) as T;
	}
	const value = await fn();
	if (isEmptyResult(value)) {
		return value;
	}
	const res = new Response(JSON.stringify(value), {
		headers: {
			"content-type": "application/json",
			"cache-control": `max-age=${ttlSeconds}`,
		},
	});
	await store.put(req, res);
	return value;
}
