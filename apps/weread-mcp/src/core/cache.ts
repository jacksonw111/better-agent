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

async function userPrefix(apiKey: string): Promise<string> {
	const data = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(apiKey)
	);
	const bytes = new Uint8Array(data);
	let hex = "";
	for (const b of bytes.slice(0, 6)) {
		hex += b.toString(16).padStart(2, "0");
	}
	return hex;
}

export async function withUserCache<T>(
	apiKey: string,
	key: string,
	ttlSeconds: number,
	fn: () => Promise<T>
): Promise<T> {
	const store = cacheStore();
	if (!store) {
		return fn();
	}
	const prefix = await userPrefix(apiKey);
	const req = new Request(
		`https://cache.local/${prefix}/${encodeURIComponent(key)}`
	);
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
