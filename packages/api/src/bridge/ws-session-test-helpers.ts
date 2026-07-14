import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	BridgeSessionRow,
	RelayEvent,
	RelayStore,
} from "@better-agent/agent/ports";
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
 * fake bridgeSession/bridgeMessage store. Pass `relayStoreOverride` (e.g. a
 * fake with a manually-controlled `read`) to exercise `createCommandPump`'s
 * in-flight-read serialization instead of the real store, whose `read`
 * always resolves on the same tick. */
export function build(
	sessionsById: Map<string, BridgeSessionRow> = new Map(),
	relayStoreOverride?: RelayStore
) {
	if (!sessionsById.has(SESSION)) {
		sessionsById.set(SESSION, sessionRow());
	}
	const touched: string[] = [];
	const persistedRows: { seq: number; event: unknown }[] = [];
	const relayStore = relayStoreOverride ?? createInMemoryRelayStore();
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
export function connect(
	sessionsById?: Map<string, BridgeSessionRow>,
	relayStoreOverride?: RelayStore
) {
	const built = build(sessionsById, relayStoreOverride);
	const { socket, frames, closed } = fakeSocket();
	const connection = createBridgeWsConnection(
		built.context,
		{ commandBus: built.commandBus, relayStore: built.relayStore },
		socket
	);
	return { ...built, connection, frames, closed };
}

const MAX_POLL_TICKS = 25;

/** Polls `predicate` across microtask ticks (bounded) — used to wait for an
 * async continuation buried behind other awaits (e.g. `handleHello`'s
 * ownership check + touch, before its first `relayStore.read`) without
 * assuming an exact tick count. */
export async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < MAX_POLL_TICKS && !predicate(); i += 1) {
		await Promise.resolve();
	}
}

/** Awaits a few microtask ticks so a promise-chain continuation (e.g.
 * `createCommandPump`'s pump loop resuming after a held read resolves)
 * settles before assertions — same pattern the live-push tests already use. */
export async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

interface HeldRead {
	afterId: number;
	resolve: (events: RelayEvent[]) => void;
}

/**
 * A `RelayStore` backed by a real in-memory store for `append`/`subscribe`,
 * but whose `read` never resolves on its own — each call is queued in
 * `pendingReads` and must be settled explicitly via `resolveOldestRead`.
 * Exists because the real in-memory store's `read` always resolves on the
 * same tick, so it can never have a notify() land WHILE a read is in
 * flight — this is what lets a test genuinely exercise
 * `createCommandPump`'s running/rerun guard instead of trivially passing
 * whether or not that guard exists.
 */
export function createHeldReadRelayStore(): {
	pendingReads: HeldRead[];
	readCalls: () => number;
	relayStore: RelayStore;
	resolveOldestRead: () => Promise<void>;
} {
	const inner = createInMemoryRelayStore();
	const pendingReads: HeldRead[] = [];
	let readCalls = 0;
	const relayStore: RelayStore = {
		append: inner.append,
		subscribe: inner.subscribe,
		readTail: inner.readTail,
		read: (_sessionId, _dir, afterId) => {
			readCalls += 1;
			return new Promise((resolve) => {
				pendingReads.push({ afterId, resolve });
			});
		},
	};
	const resolveOldestRead = async () => {
		const oldest = pendingReads.shift();
		if (!oldest) {
			throw new Error("expected a pending read to resolve");
		}
		oldest.resolve(await inner.read(SESSION, "commands", oldest.afterId));
		await flushMicrotasks();
	};
	return {
		pendingReads,
		readCalls: () => readCalls,
		relayStore,
		resolveOldestRead,
	};
}
