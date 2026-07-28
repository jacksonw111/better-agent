import { authenticateComputerWs } from "@better-agent/api/computers/ws-handshake";
import { createContext } from "@better-agent/api/context";
import type { PtyRelayConnection } from "@better-agent/api/pty/relay-hub";
import type { createNodeWebSocket } from "@hono/node-ws";
import type { EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import type { AgentServices } from "./app";
import { attachHeartbeat, type HeartbeatRaw } from "./ws-heartbeat";

// P2-1 (DP-PTY2): the server's PTY byte-relay routes. Two endpoints feed one
// in-process `ptyRelay` hub that pairs a computer's CLI daemon with its web
// viewers and forwards raw binary frames by sessionId — it never parses DATA or
// persists anything. Registered from index.ts with the SAME `upgradeWebSocket`
// instance as the other WS routes (see bridge-ws.ts's top comment for why a
// second `createNodeWebSocket({app})` is unsafe).
//
//   GET /pty/agent-ws   — the CLI daemon. Authenticated by the same Ed25519
//                         query-param scheme as /computer-ws (a WS upgrade
//                         can't set headers).
//   GET /pty/viewer-ws  — a web viewer. Authenticated by the user's JWT bearer
//                         (carried via ?access_token=, like the VNC viewer) and
//                         authorized against the computer it owns.
//
// This plane runs ENTIRELY alongside the old structured bridge/command channel;
// neither touches the other.

const HTTP_UNAUTHORIZED = 401;

function handshakeQuery(c: {
	req: { query(name: string): string | undefined };
}) {
	return {
		computerId: c.req.query("computerId"),
		sig: c.req.query("sig"),
		ts: c.req.query("ts"),
	};
}

/** Coerces a binary WS message into the bytes the relay routes on. */
function toBytes(data: unknown): Uint8Array | null {
	if (data instanceof Uint8Array) {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	return null;
}

/** A relay socket that writes binary frames to a live Hono WS. `bind` supplies
 * the socket once `onOpen` fires (deferred-bind, like bridge-ws.ts). */
function deferredSocket(): {
	bind(ws: WSContext): void;
	send(frame: Uint8Array): void;
} {
	let ws: WSContext | null = null;
	return {
		bind: (live) => {
			ws = live;
		},
		// Frames are always ArrayBuffer-backed (never SharedArrayBuffer); the cast
		// satisfies WSContext.send's Uint8Array<ArrayBuffer> parameter.
		send: (frame) => ws?.send(frame as Uint8Array<ArrayBuffer>),
	};
}

// P25-A control frames: the CLI's per-session activity signal bumps
// last-activity (throttled CLI-side), and its held-session list on (re)connect
// reconciles sessions the CLI no longer holds a pty for (e.g. after a CLI
// restart) to `ended`. Fire-and-forget — the byte relay must never block on a
// DB write.
function agentControlHandlers(services: AgentServices) {
	return {
		onActivity: (id: string, sessionId: string) => {
			services.stores.ptySession
				.touchActivity(id, sessionId)
				.catch(() => undefined);
		},
		onLiveness: (id: string, sessionIds: string[]) => {
			services.stores.ptySession
				.endStaleExcept(id, sessionIds)
				.catch(() => undefined);
		},
		// P25-C: the CLI captured/knows the underlying agent's resumable session id
		// for this pty — persist it and mark the conversation started so a later
		// respawn resumes the real conversation. Fire-and-forget like the others.
		onBind: (_id: string, sessionId: string, agentSessionId: string) => {
			services.stores.ptySession
				.setAgentSession(sessionId, agentSessionId)
				.catch(() => undefined);
		},
		// Observability slice A: the CLI's fine-grained per-session activity state.
		// Persist it verbatim (version-tolerant — no white-list, so an evolving
		// upstream state machine is never dropped); only trim and ignore an empty
		// string. Fire-and-forget like the other control handlers.
		onState: (_id: string, sessionId: string, state: string) => {
			const trimmed = state.trim();
			if (!trimmed) {
				return;
			}
			services.stores.ptySession
				.setActivityState(sessionId, trimmed, new Date())
				.catch(() => undefined);
		},
	};
}

function registerAgentRoute(
	app: Hono<EvlogVariables>,
	upgradeWebSocket: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"],
	services: AgentServices
): void {
	const deps = {
		computerStore: services.stores.computer,
		replayGuard: services.computerReplayGuard,
	};
	app.get(
		"/pty/agent-ws",
		async (c, next) => {
			const computer = await authenticateComputerWs(handshakeQuery(c), deps);
			if (!computer) {
				return c.text("Unauthorized", HTTP_UNAUTHORIZED);
			}
			return next();
		},
		upgradeWebSocket((c) => agentSocketHandlers(services, c))
	);
}

// The agent WS lifecycle for one CLI connection: bind the relay + activity/
// liveness control handlers on open, forward inbound frames, tear down on close.
function agentSocketHandlers(
	services: AgentServices,
	c: { req: { query(name: string): string | undefined } }
) {
	const computerId = c.req.query("computerId") ?? "";
	const socket = deferredSocket();
	let connection: PtyRelayConnection | null = null;
	let stopHeartbeat: (() => void) | null = null;
	return {
		onOpen: (_evt: unknown, ws: WSContext) => {
			socket.bind(ws);
			connection = services.ptyRelay.connectAgent(
				computerId,
				socket,
				agentControlHandlers(services)
			);
			stopHeartbeat = attachHeartbeat(ws.raw as HeartbeatRaw, () => {
				services.stores.computer
					.touch(computerId, new Date())
					.catch(() => undefined);
			});
		},
		onMessage: (evt: { data: unknown }) => {
			const bytes = toBytes(evt.data);
			if (bytes) {
				connection?.handleFrame(bytes);
			}
		},
		onClose: () => {
			stopHeartbeat?.();
			connection?.close();
		},
	};
}

function registerViewerRoute(
	app: Hono<EvlogVariables>,
	upgradeWebSocket: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"],
	services: AgentServices
): void {
	app.get(
		"/pty/viewer-ws",
		async (c, next) => {
			const context = await createContext({ context: c, services });
			const computerId = c.req.query("computerId");
			if (!(context.authedUser && computerId)) {
				return c.text("Unauthorized", HTTP_UNAUTHORIZED);
			}
			const computer = await services.stores.computer.getById(computerId);
			if (!computer || computer.userId !== context.authedUser.id) {
				return c.text("Unauthorized", HTTP_UNAUTHORIZED);
			}
			return next();
		},
		upgradeWebSocket((c) => {
			const computerId = c.req.query("computerId") ?? "";
			const socket = deferredSocket();
			let connection: PtyRelayConnection | null = null;
			return {
				onOpen: (_evt, ws) => {
					socket.bind(ws);
					connection = services.ptyRelay.connectViewer(computerId, socket);
				},
				onMessage: (evt) => {
					const bytes = toBytes(evt.data);
					if (bytes) {
						connection?.handleFrame(bytes);
					}
				},
				onClose: () => {
					connection?.close();
				},
			};
		})
	);
}

/** Registers `GET /pty/agent-ws` (CLI) and `GET /pty/viewer-ws` (web) on `app`,
 * both feeding `services.ptyRelay`. */
export function registerPtyWsRoutes(
	app: Hono<EvlogVariables>,
	upgradeWebSocket: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"],
	services: AgentServices
): void {
	registerAgentRoute(app, upgradeWebSocket, services);
	registerViewerRoute(app, upgradeWebSocket, services);
}
