import {
	type BridgeWsSocket,
	createBridgeWsConnection,
	type ServerFrame,
} from "@better-agent/api/bridge/ws-session";
import { createContext } from "@better-agent/api/context";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import type { AgentServices } from "./app";

// R0-T1 of the local-agent transport refactor: the CLI<->server duplex
// channel that replaces HTTP command-polling (see
// @better-agent/api/bridge/ws-session.ts for the frame protocol and the
// transport-agnostic connection state machine this file just wires to a real
// `@hono/node-ws` socket — mirrors vnc-proxy.ts's `createHonoProxySocket`
// deferred-bind pattern).
//
// IMPORTANT: this route is registered from index.ts (Node/Docker entry),
// reusing vnc-proxy.ts's single `createNodeWebSocket({app})` instance's
// `upgradeWebSocket`, NOT wired into the shared `buildApp` in app.ts — app.ts
// is also used by the Cloudflare Workers entry (worker.ts), which can't
// support long-lived WebSockets, and a second independent
// `createNodeWebSocket({app})` instance racing the first one's 'upgrade'
// listener on the same http server is unsafe (see vnc-proxy.ts's
// `registerVncRoutes` doc comment on why `upgradeWebSocket` is exposed from
// there instead of created here).

const HTTP_UNAUTHORIZED = 401;
/** Server-initiated ws-level ping cadence (protocol requirement, not app data). */
const PING_INTERVAL_MS = 15_000;
/** Terminate the raw socket once this many consecutive pings go unanswered. */
const MAX_MISSED_PONGS = 2;

/** The subset of the `ws` library's socket this file drives directly for the
 * heartbeat — kept minimal/local instead of depending on `@types/ws` here. */
interface HeartbeatRaw {
	off(event: "pong", listener: () => void): void;
	on(event: "pong", listener: () => void): void;
	ping(): void;
	terminate(): void;
}

/** Bridges Hono's callback-style WS events to the `BridgeWsSocket` interface
 * `createBridgeWsConnection` drives. `bind` is called from `onOpen` once the
 * live socket exists — identical shape to vnc-proxy.ts's deferred socket. */
function createDeferredBridgeSocket(): {
	bind(ws: WSContext): void;
	socket: BridgeWsSocket;
} {
	let ws: WSContext | null = null;
	return {
		socket: {
			close: () => ws?.close(),
			send: (frame: ServerFrame) => ws?.send(JSON.stringify(frame)),
		},
		bind: (live) => {
			ws = live;
		},
	};
}

/** Sends a ws-level ping every `PING_INTERVAL_MS` and terminates the raw
 * socket after `MAX_MISSED_PONGS` consecutive pings go unanswered. Returns a
 * cleanup function to call on close. `onPong` additionally lets the caller
 * treat a pong as session liveness (touch `lastSeenAt`). */
function attachHeartbeat(raw: HeartbeatRaw, onPong: () => void): () => void {
	let missedPongs = 0;
	const handlePong = () => {
		missedPongs = 0;
		onPong();
	};
	raw.on("pong", handlePong);
	const timer = setInterval(() => {
		if (missedPongs >= MAX_MISSED_PONGS) {
			raw.terminate();
			return;
		}
		missedPongs += 1;
		raw.ping();
	}, PING_INTERVAL_MS);
	return () => {
		clearInterval(timer);
		raw.off("pong", handlePong);
	};
}

/**
 * Registers `GET /bridge/ws` on `app`, using the SAME `upgradeWebSocket`
 * instance vnc-proxy.ts's `registerVncRoutes` created (passed in, not created
 * here — see this file's top comment for why).
 *
 * Auth: a plain Hono middleware runs BEFORE `upgradeWebSocket(...)` in the
 * same route registration. It resolves the bearer token via the same
 * `createContext` every bridge HTTP endpoint uses and returns a genuine HTTP
 * 401 (not a WS close) when it isn't a valid, unrevoked bridge token —
 * returning a Response without calling `next()` short-circuits before the WS
 * handshake, so `upgradeWebSocket`'s handler never runs and the real HTTP
 * status reaches the client. Session ownership (which bridge token may use
 * which sessionId) is NOT checked here — the connection isn't scoped to a
 * session until the first `hello` frame, so that check lives in
 * `createBridgeWsConnection`'s `handleHello` (ws-session.ts), same as
 * `requireOwnedBridgeSession` on the HTTP endpoints.
 */
export function registerBridgeWsRoute(
	app: Hono<EvlogVariables>,
	upgradeWebSocket: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"],
	services: AgentServices
): void {
	app.get(
		"/bridge/ws",
		async (c, next) => {
			const context = await createContext({ context: c, services });
			if (!context.authedBridgeToken) {
				return c.text("Unauthorized", HTTP_UNAUTHORIZED);
			}
			return next();
		},
		upgradeWebSocket(async (c) => {
			const context = await createContext({ context: c, services });
			const deferred = createDeferredBridgeSocket();
			const connection = createBridgeWsConnection(
				context,
				{ commandBus: services.commandBus, relayStore: services.relayStore },
				deferred.socket
			);
			let stopHeartbeat: (() => void) | null = null;
			return {
				onOpen: (_evt, ws) => {
					deferred.bind(ws);
					stopHeartbeat = attachHeartbeat(ws.raw as HeartbeatRaw, () => {
						connection.handlePong().catch(() => undefined);
					});
				},
				onMessage: (evt) => {
					connection.handleMessage(String(evt.data)).catch(() => undefined);
				},
				onClose: () => {
					stopHeartbeat?.();
					connection.handleClose();
				},
			};
		})
	);
}
