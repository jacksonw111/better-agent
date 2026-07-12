/**
 * The CLI end of the video plane. Pairs two byte streams for one bridge
 * session: an OUTBOUND WebSocket to the server's VNC proxy
 * (`/bridge/vnc/agent/:sessionId`, bearer-authed with the bridge token) and a
 * TCP socket to the VM's localhost VNC port (from lume's `vncUrl`). RFB bytes
 * are piped transparently both ways — the VNC handshake/auth negotiate
 * end-to-end between the browser's noVNC and the VM, never inspected here.
 *
 * The socket factories are injected so the pairing/piping is unit-testable with
 * in-memory fakes (no real WS or TCP). `parseVncTarget` and `agentWsUrl` are
 * pure and exported for direct testing.
 */

/** A byte-transparent duplex the relay pipes. Real `ws`/`net` sockets and test
 * fakes both satisfy it. */
export interface RelaySocket {
	close(): void;
	onClose(cb: () => void): void;
	onData(cb: (data: Uint8Array | string) => void): void;
	send(data: Uint8Array | string): void;
}

export interface VncRelayDeps {
	connectTcp: (host: string, port: number) => RelaySocket;
	connectWs: (url: string, headers: Record<string, string>) => RelaySocket;
	log?: (message: string) => void;
}

export interface VncRelayOptions {
	/** Bridge server base URL (http/https); converted to ws/wss here. */
	serverUrl: string;
	sessionId: string;
	/** `bt_…` bridge token — same credential the relay/session already uses. */
	token: string;
	/** lume's reported VNC URL for the VM (e.g. `vnc://127.0.0.1:59001`). */
	vncUrl: string;
}

export interface VncTarget {
	host: string;
	port: number;
}

const DEFAULT_VNC_PORT = 5900;
const SCHEME_RE = /^[a-z]+:\/\//i;
const TRAILING_SLASH_RE = /\/+$/;
const HTTP_SCHEME_RE = /^http/i;

/** Parses lume's `vncUrl` into a host/port. Accepts `vnc://[creds@]host:port`,
 * `ws(s)://host:port`, a bare `host:port`, or a bare host (→ :5900). */
export function parseVncTarget(vncUrl: string): VncTarget | null {
	const trimmed = vncUrl.trim();
	if (!trimmed) {
		return null;
	}
	// Normalize any scheme to http so the URL parser can extract host/port,
	// then fall back to a manual host:port split for scheme-less inputs.
	const normalized = trimmed.includes("://")
		? trimmed.replace(SCHEME_RE, "http://")
		: `http://${trimmed}`;
	try {
		const url = new URL(normalized);
		const host = url.hostname;
		if (!host) {
			return null;
		}
		const port = url.port ? Number(url.port) : DEFAULT_VNC_PORT;
		return Number.isFinite(port) ? { host, port } : null;
	} catch {
		return null;
	}
}

/** Builds the outbound producer WS URL from the http(s) server base. */
export function agentWsUrl(serverUrl: string, sessionId: string): string {
	const base = serverUrl
		.replace(TRAILING_SLASH_RE, "")
		.replace(HTTP_SCHEME_RE, "ws");
	return `${base}/bridge/vnc/agent/${sessionId}`;
}

function pipe(from: RelaySocket, to: RelaySocket): void {
	from.onData((data) => to.send(data));
}

export interface VncRelay {
	stop(): void;
}

/**
 * Opens both legs and pipes them. When either side closes, the other is closed
 * too (symmetric teardown), so a dropped VM VNC or a dropped server socket
 * never leaves a half-open relay. `stop()` closes both explicitly.
 */
export function startVncRelay(
	options: VncRelayOptions,
	deps: VncRelayDeps
): VncRelay {
	const target = parseVncTarget(options.vncUrl);
	if (!target) {
		throw new Error(`Unparseable VNC URL from lume: "${options.vncUrl}"`);
	}
	const log = deps.log ?? (() => undefined);
	const ws = deps.connectWs(agentWsUrl(options.serverUrl, options.sessionId), {
		authorization: `Bearer ${options.token}`,
	});
	const tcp = deps.connectTcp(target.host, target.port);

	let stopped = false;
	const stop = () => {
		if (stopped) {
			return;
		}
		stopped = true;
		ws.close();
		tcp.close();
	};

	pipe(ws, tcp);
	pipe(tcp, ws);
	ws.onClose(() => {
		log("VNC server socket closed");
		stop();
	});
	tcp.onClose(() => {
		log("VNC VM socket closed");
		stop();
	});
	log(`VNC relay up: ${target.host}:${target.port} ⇄ server`);
	return { stop };
}
