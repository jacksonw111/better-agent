import { env } from "@better-agent/env/web";

// Finance tool results hand out `pdfUrl` as a finance-mcp-relative
// `/pdf?url=<upstream>` path (see finance-mcp research.ts / periodic-reports.ts).
// finance-mcp is token-gated, so the browser can't hit it — pull the upstream
// out and re-point it at our own public, cached /pdf-proxy on the app server.

export function toUpstreamPdf(pdfUrl: string): string | null {
	try {
		// Base only matters for relative `/pdf?url=…` inputs; absolute inputs
		// ignore it.
		const parsed = new URL(pdfUrl, "http://placeholder.invalid");
		const inner = parsed.searchParams.get("url");
		if (inner) {
			return inner;
		}
		return pdfUrl.startsWith("http") ? pdfUrl : null;
	} catch {
		return null;
	}
}

export function proxyPdfUrl(pdfUrl: string): string | null {
	const upstream = toUpstreamPdf(pdfUrl);
	if (!upstream) {
		return null;
	}
	return `${env.VITE_SERVER_URL}/pdf-proxy?url=${encodeURIComponent(upstream)}`;
}
