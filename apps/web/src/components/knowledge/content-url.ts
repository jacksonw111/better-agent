import { env } from "@better-agent/env/web";
import { getAccessToken } from "@/utils/auth";

// The server's authed streaming route for a document's bytes (see
// apps/server/src/knowledge-content.ts). <img>/<iframe>/react-pdf can't set
// an Authorization header, so the bearer rides in ?access_token= — the same
// convention as the VNC viewer and bridge SSE stream.
export function documentContentUrl(
	documentId: string,
	options?: { download?: boolean }
): string {
	const token = encodeURIComponent(getAccessToken() ?? "");
	const download = options?.download ? "&download=1" : "";
	return `${env.VITE_SERVER_URL}/knowledge/${documentId}/content?access_token=${token}${download}`;
}

/** The raw-body chunk upload route (one multipart part). XHR posts here so
 * upload.onprogress can drive a byte-level progress bar — fetch/oRPC can't
 * report upload progress. */
export function documentPartUrl(
	documentId: string,
	partNumber: number
): string {
	const token = encodeURIComponent(getAccessToken() ?? "");
	return `${env.VITE_SERVER_URL}/knowledge/${documentId}/parts/${partNumber}?access_token=${token}`;
}
