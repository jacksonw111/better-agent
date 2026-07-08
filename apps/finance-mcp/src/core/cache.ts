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
	const res = new Response(JSON.stringify(value), {
		headers: {
			"content-type": "application/json",
			"cache-control": `max-age=${ttlSeconds}`,
		},
	});
	await store.put(req, res);
	return value;
}
