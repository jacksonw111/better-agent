import type { Context } from "hono";

const ALLOWED_HOST = "pdf.dfcfw.com";
const UPSTREAM_REFERER = "https://data.eastmoney.com/";
const UPSTREAM_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROXY_HEADERS = [
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"last-modified",
	"etag",
] as const;
const CACHE_CONTROL = "public, max-age=300";
const DEFAULT_CONTENT_TYPE = "application/pdf";

function validateUrl(raw: string | undefined): URL | null {
	if (!raw) {
		return null;
	}
	let target: URL;
	try {
		target = new URL(raw);
	} catch {
		return null;
	}
	if (target.protocol !== "https:" || target.host !== ALLOWED_HOST) {
		return null;
	}
	return target;
}

function buildUpstreamHeaders(range: string | undefined): Headers {
	const headers = new Headers({
		Referer: UPSTREAM_REFERER,
		"User-Agent": UPSTREAM_UA,
	});
	if (range) {
		headers.set("Range", range);
	}
	return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
	const headers = new Headers();
	for (const h of PROXY_HEADERS) {
		const v = upstream.headers.get(h);
		if (v) {
			headers.set(h, v);
		}
	}
	if (!headers.has("content-type")) {
		headers.set("content-type", DEFAULT_CONTENT_TYPE);
	}
	headers.set("cache-control", CACHE_CONTROL);
	return headers;
}

export function createPdfProxyHandler(fetchImpl: typeof fetch) {
	return async (c: Context): Promise<Response> => {
		const target = validateUrl(c.req.query("url"));
		if (!target) {
			return c.text("forbidden host", 400);
		}
		const upstream = await fetchImpl(target.toString(), {
			headers: buildUpstreamHeaders(c.req.header("range")),
			redirect: "manual",
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: buildResponseHeaders(upstream),
		});
	};
}
