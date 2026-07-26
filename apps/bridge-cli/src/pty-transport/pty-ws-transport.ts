// The CLI daemon's PTY transport connection loop (Slice P2-1). Mirrors
// task-launch/control-ws.ts: one `GET /pty/agent-ws` WS per computer,
// authenticated by the SAME Ed25519 query-param scheme (a WS upgrade can't set
// headers), reconnecting forever with the shared backoff schedule. The one
// difference from the control channel is the payload — raw binary PTY frames
// (DP-PTY2), not JSON — so this uses a binary-capable socket instead of the
// string-only `WsLike`, and drives a `PtySessionManager` (which owns the actual
// ptys, scrollback, coalescing and flow control).
//
// On every reconnect after the first successful open, `manager.onReconnect()`
// replays each live session's scrollback from its last ACK cursor, so a viewer
// continues without a gap (DP-PTY3).

import { signComputerRequest } from "@better-agent/agent/crypto/computer-signature";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";
import WebSocket from "ws";
import type { ComputerSigningIdentity } from "../computer-transport";
import { createMonotonicTimestamp } from "../computer-transport";
import { reconnectDelayMs } from "../ws-duplex-backoff";
import type { WsEventMap } from "../ws-duplex-socket";
import {
	createPtySessionManager,
	type PtySpawnFn,
} from "./pty-session-manager";

const TRAILING_SLASH = /\/$/;
const HTTP_SCHEME_PREFIX = /^http/;

/** A binary WS: like `WsLike` but `send` takes bytes (the PTY plane never sends
 * strings). Kept separate from ws-duplex-socket.ts's string `WsLike` so the old
 * structured-event channel is untouched. */
export interface PtyWsLike {
	close(): void;
	on<E extends keyof WsEventMap>(event: E, listener: WsEventMap[E]): void;
	send(data: Uint8Array): void;
}

export type PtyWsFactory = (
	url: string,
	headers: Record<string, string>
) => PtyWsLike;

/** Production `PtyWsFactory`: a real `ws` client socket. Unlike the
 * string-only `defaultWsFactory` (ws-duplex-socket.ts), `send` here carries
 * binary frames — `ws` emits inbound binary as a Buffer, which the transport's
 * `toBytes` already coerces. Auth rides in the URL's query params (a WS upgrade
 * can't set headers), so no headers are actually needed, but the signature is
 * kept uniform with the other factory. */
export const defaultPtyWsFactory: PtyWsFactory = (url, headers) =>
	new WebSocket(url, { headers }) as unknown as PtyWsLike;

export interface PtyTransportConfig {
	identity: ComputerSigningIdentity;
	log?: (message: string) => void;
	nextTimestamp?: () => number;
	serverUrl: string;
	signal: AbortSignal;
	sleep?: (ms: number) => Promise<void>;
	/** Injectable for tests — defaults to the real pty-broker spawn. */
	spawn?: PtySpawnFn;
	wsFactory: PtyWsFactory;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The signed handshake URL — a FRESH timestamp + signature per attempt, since
 * the server's replay guard rejects any non-advancing timestamp. */
export function ptyAgentWsUrl(
	config: PtyTransportConfig,
	nextTimestamp: () => number
): string {
	const base = config.serverUrl
		.replace(TRAILING_SLASH, "")
		.replace(HTTP_SCHEME_PREFIX, "ws");
	const timestampMs = nextTimestamp();
	const query = new URLSearchParams({
		computerId: config.identity.computerId,
		sig: signComputerRequest(
			config.identity.privateKeyPem,
			config.identity.computerId,
			timestampMs
		),
		ts: String(timestampMs),
	});
	return `${base}/pty/agent-ws?${query.toString()}`;
}

/** Coerces whatever the WS delivers for a binary message into a Uint8Array. */
function toBytes(data: unknown): Uint8Array | null {
	if (data instanceof Uint8Array) {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((part) => Buffer.from(part as Uint8Array)));
	}
	return null;
}

interface ConnectHandlers {
	nextTimestamp: () => number;
	onFrame: (frame: Uint8Array) => void;
	/** Fires the moment the socket opens (before any frame) with the live
	 * socket — the loop binds `send` here and, on a re-open, replays scrollback. */
	onOpen: (socket: PtyWsLike) => void;
}

/** One connection's lifetime: resolves `{ opened }` when the socket drops (or
 * the signal aborts). Never rejects — the outer loop just reconnects. */
function connectOnce(
	config: PtyTransportConfig,
	handlers: ConnectHandlers
): Promise<{ opened: boolean }> {
	return new Promise((resolve) => {
		const socket = config.wsFactory(
			ptyAgentWsUrl(config, handlers.nextTimestamp),
			{}
		);
		let opened = false;
		let settled = false;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			config.signal.removeEventListener("abort", onAbort);
			resolve({ opened });
		};
		const onAbort = () => {
			socket.close();
			finish();
		};
		socket.on("open", () => {
			opened = true;
			handlers.onOpen(socket);
		});
		socket.on("message", (data) => {
			const bytes = toBytes(data);
			if (bytes) {
				handlers.onFrame(bytes);
			}
		});
		socket.on("close", finish);
		socket.on("error", finish);
		config.signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Runs the PTY transport until `signal` aborts: connect, multiplex every
 * session's frames over the one WS, and on any drop wait the backoff delay
 * (reset by a successful open) before reconnecting with a fresh signed URL. On
 * a RE-open the session manager replays each live session's scrollback from its
 * ACK cursor (DP-PTY3), so a viewer resumes without a gap.
 */
export async function runPtyTransport(
	config: PtyTransportConfig
): Promise<void> {
	const nextTimestamp = config.nextTimestamp ?? createMonotonicTimestamp();
	const sleep = config.sleep ?? defaultSleep;
	let socket: PtyWsLike | null = null;
	const manager = createPtySessionManager({
		send: (frame) => socket?.send(frame),
		spawn: config.spawn,
	});

	let everOpened = false;
	let failedAttempts = 0;
	while (!config.signal.aborted) {
		const reconnecting = everOpened;
		const { opened } = await connectOnce(config, {
			nextTimestamp,
			onFrame: (frame) => {
				const decoded = decodeFrame(frame);
				if (decoded) {
					manager.handleFrame(decoded);
				}
			},
			onOpen: (live) => {
				socket = live;
				everOpened = true;
				// P25-A: report the ptys this CLI still holds so the server can
				// reconcile away zombies (a fresh start holds none → the server ends
				// that computer's stale active sessions). Sent on every (re)connect.
				manager.reportLiveness();
				// A re-open (not the very first): resume each session from its ACK
				// cursor now that a live socket exists to carry the burst.
				if (reconnecting) {
					manager.onReconnect();
				}
			},
		});
		socket = null;
		if (config.signal.aborted) {
			break;
		}
		failedAttempts = opened ? 0 : failedAttempts + 1;
		config.log?.(
			`pty transport down — reconnecting (attempt ${failedAttempts + 1})`
		);
		await sleep(reconnectDelayMs(opened ? 0 : failedAttempts - 1));
	}
	manager.closeAll();
}
