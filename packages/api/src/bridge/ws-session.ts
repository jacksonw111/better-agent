import type { RelayStore } from "@better-agent/agent/ports";
import { z } from "zod";
import type { Context } from "../context";
import type { CommandBus } from "./command-bus";
import { ingestEvents } from "./ingest-events";
import { requireOwnedBridgeSession } from "./ownership";

// The server half of the CLI<->server WS duplex channel (R0-T1 of the
// bridge transport refactor). This module is transport-agnostic — it only
// knows about `BridgeWsSocket` (send/close), not Hono or `ws`/`@hono/node-ws`
// — so it's unit-testable with a fake socket the same way vnc-proxy.ts's
// registry is (see apps/server/src/vnc-proxy.test.ts) and
// bridge/stream.ts's `observeBridgeEvents` is. The real adapter wiring a live
// socket to this lives in apps/server/src/bridge-ws.ts.
//
// FIXED frame protocol (agreed with the human, do not change without
// updating the CLI half in lockstep):
//   CLI→server: {t:"hello", sessionId, afterId}
//               {t:"events", batchId, events, idempotencyKeys}
//   server→CLI: {t:"hello_ok"}
//               {t:"command", id, data}      // one relay command per frame, ascending id
//               {t:"events_ack", batchId}
//               {t:"error", message}         // fatal — server closes

const helloFrameSchema = z.object({
	afterId: z.number().int().min(0),
	sessionId: z.string(),
	t: z.literal("hello"),
});
const eventsFrameSchema = z.object({
	batchId: z.string(),
	events: z.array(z.unknown()),
	idempotencyKeys: z.array(z.string()),
	t: z.literal("events"),
});
const clientFrameSchema = z.discriminatedUnion("t", [
	helloFrameSchema,
	eventsFrameSchema,
]);

export type HelloFrame = z.infer<typeof helloFrameSchema>;
export type EventsFrame = z.infer<typeof eventsFrameSchema>;
export type ClientFrame = z.infer<typeof clientFrameSchema>;

export interface HelloOkFrame {
	t: "hello_ok";
}
export interface CommandFrame {
	data: unknown;
	id: number;
	t: "command";
}
export interface EventsAckFrame {
	batchId: string;
	t: "events_ack";
}
export interface ErrorFrame {
	message: string;
	t: "error";
}
export type ServerFrame =
	| HelloOkFrame
	| CommandFrame
	| EventsAckFrame
	| ErrorFrame;

/** Minimal transport a connection drives — a real WS and a test fake both
 * satisfy it, mirroring vnc-proxy.ts's `ProxySocket`. */
export interface BridgeWsSocket {
	close(): void;
	send(frame: ServerFrame): void;
}

export interface BridgeWsConnection {
	/** Cleanup on socket close: unsubscribes from the CommandBus. */
	handleClose(): void;
	/** One raw inbound WS text message. */
	handleMessage(raw: string): Promise<void>;
	/** Call on a ws-level pong — keeps a quiet-but-alive session "seen". */
	handlePong(): Promise<void>;
}

function parseClientFrame(raw: string): ClientFrame | null {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const result = clientFrameSchema.safeParse(json);
	return result.success ? result.data : null;
}

/**
 * Replays/pushes `commands` frames for one session, serialized so a live
 * CommandBus notification arriving while a read is already in flight can
 * never race that read into sending a command twice (or missing one): a
 * notify during an in-flight pump just marks `rerun`, so the pump loops
 * exactly once more (reading from the now-updated `lastSentId`) instead of
 * kicking off a second concurrent read.
 */
function createCommandPump(
	relayStore: RelayStore,
	sessionId: string,
	afterId: number,
	send: (frame: CommandFrame) => void
): { pump: () => Promise<void> } {
	let lastSentId = afterId;
	let running = false;
	let rerun = false;

	async function drainOnce(): Promise<void> {
		const commands = await relayStore.read(sessionId, "commands", lastSentId);
		for (const command of commands) {
			send({ t: "command", id: command.id, data: command.data });
			lastSentId = command.id;
		}
	}

	return {
		async pump() {
			if (running) {
				rerun = true;
				return;
			}
			running = true;
			try {
				do {
					rerun = false;
					await drainOnce();
				} while (rerun);
			} finally {
				running = false;
			}
		},
	};
}

export interface BridgeWsDeps {
	commandBus: CommandBus;
	relayStore: RelayStore;
}

/** Mutable per-connection state, threaded through the extracted handlers
 * below instead of closed over — keeps `createBridgeWsConnection` itself (the
 * function eslint's max-lines-per-function measures) small. */
interface ConnectionState {
	sessionId: string | null;
	unsubscribe: (() => void) | null;
}

/** Everything a frame handler needs, bundled into one param (instead of 4-5
 * separate ones) to stay under eslint's max-params gate. */
interface Conn {
	context: Context;
	deps: BridgeWsDeps;
	socket: BridgeWsSocket;
	state: ConnectionState;
}

function fail(socket: BridgeWsSocket, message: string): void {
	socket.send({ t: "error", message });
	socket.close();
}

async function handleHello(conn: Conn, frame: HelloFrame): Promise<void> {
	const { context, deps, socket, state } = conn;
	const token = context.authedBridgeToken;
	if (!token) {
		fail(socket, "unauthorized");
		return;
	}
	try {
		await requireOwnedBridgeSession(context, token.userId, frame.sessionId);
	} catch {
		fail(socket, "session not found");
		return;
	}
	state.sessionId = frame.sessionId;
	socket.send({ t: "hello_ok" });
	await context.services.stores.bridgeSession.touch(state.sessionId);
	const commandPump = createCommandPump(
		deps.relayStore,
		state.sessionId,
		frame.afterId,
		(commandFrame) => socket.send(commandFrame)
	);
	state.unsubscribe = deps.commandBus.subscribe(state.sessionId, () => {
		commandPump.pump().catch(() => undefined);
	});
	await commandPump.pump();
}

async function handleEvents(conn: Conn, frame: EventsFrame): Promise<void> {
	const { context, socket, state } = conn;
	const token = context.authedBridgeToken;
	if (!(token && state.sessionId)) {
		fail(socket, "hello required");
		return;
	}
	try {
		await ingestEvents(context, {
			sessionId: state.sessionId,
			userId: token.userId,
			events: frame.events,
			idempotencyKeys: frame.idempotencyKeys,
		});
	} catch {
		fail(socket, "invalid events frame");
		return;
	}
	socket.send({ t: "events_ack", batchId: frame.batchId });
}

async function handleFrame(conn: Conn, raw: string): Promise<void> {
	const { socket, state } = conn;
	const frame = parseClientFrame(raw);
	if (!frame) {
		fail(socket, "malformed frame");
		return;
	}
	if (!state.sessionId) {
		if (frame.t !== "hello") {
			fail(socket, "expected hello");
			return;
		}
		await handleHello(conn, frame);
		return;
	}
	if (frame.t === "events") {
		await handleEvents(conn, frame);
		return;
	}
	fail(socket, "unexpected frame");
}

/** Drives one bridge WS connection's protocol state machine against
 * `context` (already resolved from the upgrade request's bearer token — see
 * bridge-ws.ts) and `socket`. */
export function createBridgeWsConnection(
	context: Context,
	deps: BridgeWsDeps,
	socket: BridgeWsSocket
): BridgeWsConnection {
	const conn: Conn = {
		context,
		deps,
		socket,
		state: { sessionId: null, unsubscribe: null },
	};

	return {
		handleMessage: (raw) => handleFrame(conn, raw),
		async handlePong() {
			if (conn.state.sessionId) {
				await context.services.stores.bridgeSession.touch(conn.state.sessionId);
			}
		},
		handleClose() {
			conn.state.unsubscribe?.();
		},
	};
}
