import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type { BridgeSessionRow } from "@better-agent/agent/ports";
import type { Context } from "../context";
import { createCommandBus } from "./command-bus";
import { createBridgeWsConnection, type ServerFrame } from "./ws-session";

// Shared test harness for ws-session.test.ts / ws-session-protocol.test.ts,
// split out so both test files (and their describe blocks) stay under the
// per-file / per-function line caps.

export const OWNER = "alice";
export const SESSION = "sess-1";

export function sessionRow(
	overrides: Partial<BridgeSessionRow> = {}
): BridgeSessionRow {
	return {
		id: SESSION,
		userId: OWNER,
		tokenId: "tok-1",
		agentKind: "claude-code",
		label: null,
		agentSessionId: null,
		status: "active",
		createdAt: new Date(),
		lastSeenAt: new Date(),
		vncEndpoint: null,
		...overrides,
	};
}

/** In-memory harness: real CommandBus + real in-memory RelayStore (so
 * replay/live-push exercise the actual serialization logic), plus a minimal
 * fake bridgeSession/bridgeMessage store. */
export function build(sessionsById: Map<string, BridgeSessionRow> = new Map()) {
	if (!sessionsById.has(SESSION)) {
		sessionsById.set(SESSION, sessionRow());
	}
	const touched: string[] = [];
	const persistedRows: { seq: number; event: unknown }[] = [];
	const relayStore = createInMemoryRelayStore();
	const commandBus = createCommandBus();
	const context = {
		authedBridgeToken: { tokenId: "tok-1", userId: OWNER },
		services: {
			commandBus,
			relayStore,
			stores: {
				bridgeSession: {
					get: (id: string) => Promise.resolve(sessionsById.get(id) ?? null),
					touch: (id: string) => {
						touched.push(id);
						return Promise.resolve();
					},
					setAgentSessionId: () => Promise.resolve(),
				},
				bridgeMessage: {
					appendMany: (_sessionId: string, rows: typeof persistedRows) => {
						persistedRows.push(...rows);
						return Promise.resolve();
					},
				},
			},
		},
	} as unknown as Context;
	return { context, relayStore, commandBus, touched, persistedRows };
}

function fakeSocket(): {
	closed: () => boolean;
	frames: ServerFrame[];
	socket: { close(): void; send(frame: ServerFrame): void };
} {
	const frames: ServerFrame[] = [];
	let closed = false;
	return {
		frames,
		closed: () => closed,
		socket: {
			send: (frame) => frames.push(frame),
			close: () => {
				closed = true;
			},
		},
	};
}

/** Builds a harness AND wires a fresh `createBridgeWsConnection` against a
 * fake socket in one call, so each test only needs one line of setup. */
export function connect(sessionsById?: Map<string, BridgeSessionRow>) {
	const built = build(sessionsById);
	const { socket, frames, closed } = fakeSocket();
	const connection = createBridgeWsConnection(
		built.context,
		{ commandBus: built.commandBus, relayStore: built.relayStore },
		socket
	);
	return { ...built, connection, frames, closed };
}
