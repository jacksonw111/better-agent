import type { Context } from "hono";

// Browser-reachable proxy for report/research PDFs. The tool results hand out a
// finance-mcp-relative `/pdf?url=<upstream>` path, but finance-mcp is token-
// gated, so the browser fetches through here instead. The upstream host is
// allow-listed (this is NOT an open proxy), a Referer/UA the CDN expects is
// attached, Range requests are forwarded (so react-pdf can stream pages), and
// responses are cached hard since a published report PDF never changes.

const ALLOWED_HOSTS = new Set(["pdf.dfcfw.com"]);
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
const CACHE_CONTROL = "public, max-age=86400, immutable";
const DEFAULT_CONTENT_TYPE = "application/pdf";
const HTTP_BAD_REQUEST = 400;

export type FetchFn = typeof fetch;

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
	if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.host)) {
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
	for (const name of PROXY_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}
	if (!headers.has("content-type")) {
		headers.set("content-type", DEFAULT_CONTENT_TYPE);
	}
	headers.set("cache-control", CACHE_CONTROL);
	return headers;
}

export function createPdfProxyHandler(fetchImpl: FetchFn) {
	return async (c: Context): Promise<Response> => {
		const target = validateUrl(c.req.query("url"));
		if (!target) {
			return c.text("missing or forbidden url", HTTP_BAD_REQUEST);
		}
		const upstream = await fetchImpl(target.toString(), {
			headers: buildUpstreamHeaders(c.req.header("range")),
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: buildResponseHeaders(upstream),
		});
	};
}
