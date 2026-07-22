import { refreshAccessTokenShared } from "@/utils/orpc";
import { documentContentUrl } from "../content-url";

// Preview viewers pull bytes straight off the streaming content route. One
// refresh-then-retry on 401 (shared/deduped) mirrors the chunk-upload path,
// so a stale access token embedded in the URL never breaks a preview.

const HTTP_UNAUTHORIZED = 401;

async function fetchContent(documentId: string): Promise<Response> {
	let res = await fetch(documentContentUrl(documentId));
	if (res.status === HTTP_UNAUTHORIZED && (await refreshAccessTokenShared())) {
		res = await fetch(documentContentUrl(documentId));
	}
	if (!res.ok) {
		throw new Error(`Preview download failed (${res.status})`);
	}
	return res;
}

export async function fetchDocumentBytes(
	documentId: string
): Promise<ArrayBuffer> {
	return await (await fetchContent(documentId)).arrayBuffer();
}

export async function fetchDocumentText(documentId: string): Promise<string> {
	return await (await fetchContent(documentId)).text();
}
