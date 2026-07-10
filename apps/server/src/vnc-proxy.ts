import { requireOwnedBridgeSession } from "@better-agent/api/bridge/ownership";
import { createContext } from "@better-agent/api/context";
import { createNodeWebSocket } from "@hono/node-ws";
import type { EvlogVariables } from "evlog/hono";
import type { Hono, Context as HonoContext } from "hono";
import type { WSContext } from "hono/ws";
import type { AgentServices } from "./app";

/** RFB payload flowing across the video plane. Never inspected — piped as-is. */
export type VncData = string | ArrayBuffer | Uint8Array;

/**
 * Minimal transport the registry drives. A real Hono WebSocket and an in-memory
 * test fake both satisfy it, so the pairing/piping logic is unit-testable
 * without opening a socket.
 */
export interface ProxySocket {
	close(): void;
	onClose(cb: () => void): void;
	onMessage(cb: (data: VncData) => void): void;
	send(data: VncData): void;
}

interface Pair {
	consumer: ProxySocket | null;
	producer: ProxySocket | null;
}

type Role = "producer" | "consumer";

/** The other side of the pair for a given role — where this side's bytes go. */
function counterpartOf(pair: Pair, role: Role): ProxySocket | null {
	return role === "producer" ? pair.consumer : pair.producer;
}

/** The socket currently occupying this role's slot. */
function selfOf(pair: Pair, role: Role): ProxySocket | null {
	return role === "producer" ? pair.producer : pair.consumer;
}

function setSide(pair: Pair, role: Role, socket: ProxySocket | null): void {
	if (role === "producer") {
		pair.producer = socket;
	} else {
		pair.consumer = socket;
	}
}

function getPair(pairs: Map<string, Pair>, sessionId: string): Pair {
	const existing = pairs.get(sessionId);
	if (existing) {
		return existing;
	}
	const fresh: Pair = { consumer: null, producer: null };
	pairs.set(sessionId, fresh);
	return fresh;
}

function teardown(pairs: Map<string, Pair>, sessionId: string): void {
	const pair = pairs.get(sessionId);
	if (!pair) {
		return;
	}
	pairs.delete(sessionId);
	const { producer, consumer } = pair;
	pair.producer = null;
	pair.consumer = null;
	producer?.close();
	consumer?.close();
}

/**
 * Installs `socket` in its role's slot and wires piping + teardown. Identity
 * guards (`selfOf(...) === socket`) make replacement safe: a socket that has
 * been superseded no longer pipes and its close no longer tears the pair down.
 */
function attachSide(
	pairs: Map<string, Pair>,
	sessionId: string,
	socket: ProxySocket,
	role: Role
): void {
	const pair = getPair(pairs, sessionId);
	const previous = selfOf(pair, role);
	setSide(pair, role, socket);
	// Superseded before close(), so the stale socket's onClose is a no-op.
	previous?.close();
	socket.onMessage((data) => {
		if (selfOf(pair, role) === socket) {
			counterpartOf(pair, role)?.send(data);
		}
	});
	socket.onClose(() => {
		if (selfOf(pair, role) === socket) {
			teardown(pairs, sessionId);
		}
	});
}

export interface VncProxyRegistry {
	/** Number of sessions with at least one side attached (test/introspection). */
	activeSessionCount(): number;
	/** Register the browser's noVNC socket (the viewer). */
	attachConsumer(sessionId: string, socket: ProxySocket): void;
	/** Register the CLI's outbound socket (source of the VM framebuffer). */
	attachProducer(sessionId: string, socket: ProxySocket): void;
}

/**
 * Pairs one producer (CLI) with one consumer (browser) per `sessionId` and
 * pipes RFB bytes both ways: producer→consumer is the framebuffer, and
 * consumer→producer is client input. Teardown is symmetric — when either side
 * closes, the other is closed and the pair is dropped.
 *
 * Design decisions:
 * - A consumer message that arrives while no producer is attached is DROPPED,
 *   not buffered. RFB has no meaningful client traffic before the server-side
 *   stream exists, and buffering would only grow unbounded on a half-open pair.
 * - A duplicate producer (or consumer) REPLACES the previous one: the stale
 *   socket is closed and the newcomer takes over the live pair. This makes a
 *   CLI/browser reconnect self-heal instead of being rejected against a dead
 *   socket.
 */
export function createVncProxyRegistry(): VncProxyRegistry {
	const pairs = new Map<string, Pair>();
	return {
		attachProducer: (sessionId, socket) =>
			attachSide(pairs, sessionId, socket, "producer"),
		attachConsumer: (sessionId, socket) =>
			attachSide(pairs, sessionId, socket, "consumer"),
		activeSessionCount: () => pairs.size,
	};
}

const WS_CLOSE_POLICY = 1008;

/**
 * Bridges Hono's callback-style WS events to the `ProxySocket` interface the
 * registry drives. `bind` is called from `onOpen` once the live socket exists.
 */
function createHonoProxySocket(): {
	socket: ProxySocket;
	bind(ws: WSContext): void;
	emitMessage(data: VncData): void;
	emitClose(): void;
} {
	let ws: WSContext | null = null;
	let messageCb: ((data: VncData) => void) | null = null;
	let closeCb: (() => void) | null = null;
	return {
		socket: {
			send: (data) => ws?.send(data as Parameters<WSContext["send"]>[0]),
			close: () => ws?.close(),
			onMessage: (cb) => {
				messageCb = cb;
			},
			onClose: (cb) => {
				closeCb = cb;
			},
		},
		bind: (live) => {
			ws = live;
		},
		emitMessage: (data) => messageCb?.(data),
		emitClose: () => closeCb?.(),
	};
}

/** Auth + registry the two WS routes depend on. Injected so routes stay thin. */
export interface VncRouteDeps {
	/** True when the caller is a valid bridge token that owns `sessionId`. */
	authorizeAgent(c: HonoContext, sessionId: string): Promise<boolean>;
	/** True when the caller is the signed-in owner of `sessionId`. */
	authorizeViewer(c: HonoContext, sessionId: string): Promise<boolean>;
	registry: VncProxyRegistry;
}

/**
 * Default auth wiring built from the server's services. Mirrors the bridge
 * router: the agent route is bridge-token + session-ownership (like
 * `bridgeProcedure` + `requireOwnedBridgeSession`); the viewer route is
 * signed-in-owner (like `requireOwnedBridgeSession` on `userProcedure`).
 */
export function createVncRouteDeps(services: AgentServices): VncRouteDeps {
	const ownsSession = async (
		c: HonoContext,
		sessionId: string,
		userId: string
	): Promise<boolean> => {
		const context = await createContext({ context: c, services });
		try {
			await requireOwnedBridgeSession(context, userId, sessionId);
			return true;
		} catch {
			return false;
		}
	};
	return {
		registry: createVncProxyRegistry(),
		authorizeAgent: async (c, sessionId) => {
			const context = await createContext({ context: c, services });
			const token = context.authedBridgeToken;
			if (!token) {
				return false;
			}
			return ownsSession(c, sessionId, token.userId);
		},
		authorizeViewer: async (c, sessionId) => {
			const context = await createContext({ context: c, services });
			const user = context.authedUser;
			if (!user || user.blocked) {
				return false;
			}
			return ownsSession(c, sessionId, user.id);
		},
	};
}

/**
 * Registers the two session-scoped VNC WebSocket routes on `app` and returns
 * `injectWebSocket`, which the Node entrypoint calls on the http server to
 * enable upgrades. Only wired on the Node (Docker) deployment — long-lived WS
 * are unsupported on the Workers entry, which never calls this.
 */
export function registerVncRoutes(
	app: Hono<EvlogVariables>,
	deps: VncRouteDeps
): {
	injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
} {
	const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

	app.get(
		"/bridge/vnc/agent/:sessionId",
		upgradeWebSocket(async (c) => {
			const sessionId = c.req.param("sessionId");
			if (!(sessionId && (await deps.authorizeAgent(c, sessionId)))) {
				return {
					onOpen: (_evt, ws) => ws.close(WS_CLOSE_POLICY, "unauthorized"),
				};
			}
			const bridge = createHonoProxySocket();
			return {
				onOpen: (_evt, ws) => {
					bridge.bind(ws);
					deps.registry.attachProducer(sessionId, bridge.socket);
				},
				onMessage: (evt) => bridge.emitMessage(evt.data as VncData),
				onClose: () => bridge.emitClose(),
			};
		})
	);

	app.get(
		"/bridge/vnc/viewer/:sessionId",
		upgradeWebSocket(async (c) => {
			const sessionId = c.req.param("sessionId");
			if (!(sessionId && (await deps.authorizeViewer(c, sessionId)))) {
				return {
					onOpen: (_evt, ws) => ws.close(WS_CLOSE_POLICY, "unauthorized"),
				};
			}
			const bridge = createHonoProxySocket();
			return {
				onOpen: (_evt, ws) => {
					bridge.bind(ws);
					deps.registry.attachConsumer(sessionId, bridge.socket);
				},
				onMessage: (evt) => bridge.emitMessage(evt.data as VncData),
				onClose: () => bridge.emitClose(),
			};
		})
	);

	return { injectWebSocket };
}
