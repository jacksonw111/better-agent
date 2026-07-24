// P2-2: builds the URL for the server's PTY viewer WebSocket. The user's JWT
// rides in `?access_token=` (browsers can't set headers on a WS upgrade — same
// scheme the noVNC viewer uses), and the computer whose relay hub we attach to
// is named by `?computerId=`. The session itself is selected later, in-band,
// via the OPEN frame the driver sends once the socket is up.

import { env } from "@better-agent/env/web";
import { getAccessToken } from "@/utils/auth";

const HTTP_SCHEME = /^http/;

/** Base-off exponential reconnect backoff (ms), capped — a small local copy of
 * the CLI's `reconnectDelayMs`, which lives in a package the web can't import. */
const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000] as const;

export function reconnectDelayMs(attempt: number): number {
	const index = Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1);
	return BACKOFF_MS[index];
}

/** `wss://…/pty/viewer-ws?computerId=…&access_token=…`, or `null` when the user
 * has no access token yet (unauthenticated — nothing to connect with). */
export function ptyViewerUrl(computerId: string): string | null {
	const token = getAccessToken();
	if (!token) {
		return null;
	}
	const base = env.VITE_SERVER_URL.replace(HTTP_SCHEME, "ws");
	const query = new URLSearchParams({
		computerId,
		access_token: token,
	});
	return `${base}/pty/viewer-ws?${query.toString()}`;
}
