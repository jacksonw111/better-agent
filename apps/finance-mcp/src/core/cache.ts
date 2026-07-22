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

const MS_PER_SECOND = 1000;

// Node fallback: on Cloudflare Workers `caches.default` is a shared HTTP cache;
// under Node (docker compose) there is no such global, so we keep a simple
// per-process TTL map. It is naturally isolated per container and lost on
// restart — good enough for the short TTLs used here (quotes, lists) and a
// strict improvement over refetching every call.
interface MemEntry {
	expiresAt: number;
	value: unknown;
}
const memStore = new Map<string, MemEntry>();

function memMatch<T>(key: string): { hit: boolean; value?: T } {
	const entry = memStore.get(key);
	if (!entry) {
		return { hit: false };
	}
	if (entry.expiresAt <= Date.now()) {
		memStore.delete(key);
		return { hit: false };
	}
	return { hit: true, value: entry.value as T };
}

function memPut(key: string, value: unknown, ttlSeconds: number): void {
	memStore.set(key, {
		value,
		expiresAt: Date.now() + ttlSeconds * MS_PER_SECOND,
	});
}

/** Test helper: drop all in-process cache entries. */
export function clearMemoryCache(): void {
	memStore.clear();
}

async function withWorkersCache<T>(
	store: CachesLike["default"],
	key: string,
	ttlSeconds: number,
	fn: () => Promise<T>
): Promise<T> {
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

async function withMemoryCache<T>(
	key: string,
	ttlSeconds: number,
	fn: () => Promise<T>
): Promise<T> {
	const cached = memMatch<T>(key);
	if (cached.hit) {
		return cached.value as T;
	}
	const value = await fn();
	if (isEmptyResult(value)) {
		return value;
	}
	memPut(key, value, ttlSeconds);
	return value;
}

export function withCache<T>(
	key: string,
	ttlSeconds: number,
	fn: () => Promise<T>
): Promise<T> {
	const store = cacheStore();
	if (store) {
		return withWorkersCache(store, key, ttlSeconds, fn);
	}
	return withMemoryCache(key, ttlSeconds, fn);
}
