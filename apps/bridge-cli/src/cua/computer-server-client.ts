/**
 * Thin WebSocket client for a Cua VM's `computer-server`. Local `lume` VMs run
 * the computer-server (FastAPI) which exposes a single WebSocket route `/ws`;
 * clients send JSON `{ command, params }` envelopes and the server replies with
 * `{ success, ...result }` on success or `{ success: false, error }` on failure
 * (verified against `libs/python/computer-server/.../main.py`). Local `lume`
 * VMs are NOT cloud-managed, so no `authenticate` handshake is performed — the
 * cloud SDK `@trycua/computer` is deliberately not used here.
 *
 * Replies carry no correlation id and the server processes commands strictly
 * one-at-a-time, so this client matches replies to requests in FIFO order.
 */

/** Minimal browser-style WebSocket surface this client depends on. Node's
 * global `WebSocket` (Node 22+) and the `ws` package both satisfy it, and tests
 * inject a fake so no real socket is ever opened. */
export interface WebSocketLike {
	close: () => void;
	onclose: ((event?: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onopen: ((event?: unknown) => void) | null;
	send: (data: string) => void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface ComputerServerClient {
	close: () => void;
	connect: () => Promise<void>;
	send: (
		command: string,
		params?: Record<string, unknown>
	) => Promise<Record<string, unknown>>;
}

export interface CreateComputerServerClientOptions {
	/** Per-command reply timeout. Defaults to 30s. */
	requestTimeoutMs?: number;
	/** The VM computer-server WebSocket URL, e.g. `ws://<vmIp>:8000/ws`. */
	url: string;
	/** Injected WebSocket constructor (fake in tests). */
	wsImpl?: WebSocketCtor;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

interface PendingRequest {
	command: string;
	reject: (error: Error) => void;
	resolve: (value: Record<string, unknown>) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface ClientState {
	pending: PendingRequest[];
	requestTimeoutMs: number;
	socket: WebSocketLike | null;
	url: string;
	wsImpl?: WebSocketCtor;
}

function resolveWebSocketCtor(wsImpl?: WebSocketCtor): WebSocketCtor {
	if (wsImpl) {
		return wsImpl;
	}
	const globalWs = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
	if (globalWs) {
		return globalWs;
	}
	throw new Error(
		"No WebSocket implementation available; pass `wsImpl` or run on a runtime with a global WebSocket (Node 22+)."
	);
}

function toError(value: unknown, fallback: string): Error {
	if (value instanceof Error) {
		return value;
	}
	const message = (value as { message?: unknown })?.message;
	return new Error(typeof message === "string" ? message : fallback);
}

function textOf(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}
	return (data as { toString: () => string }).toString();
}

function safeClose(ws: WebSocketLike | null): void {
	if (!ws) {
		return;
	}
	try {
		ws.close();
	} catch {
		// ignore close failures on a socket that never opened
	}
}

function removePending(state: ClientState, entry: PendingRequest): void {
	const idx = state.pending.indexOf(entry);
	if (idx >= 0) {
		state.pending.splice(idx, 1);
	}
}

function failAll(state: ClientState, error: Error): void {
	while (state.pending.length > 0) {
		const entry = state.pending.shift();
		if (entry) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
	}
}

function handleMessage(state: ClientState, data: unknown): void {
	const entry = state.pending.shift();
	if (!entry) {
		return;
	}
	clearTimeout(entry.timer);
	let reply: Record<string, unknown>;
	try {
		reply = JSON.parse(textOf(data)) as Record<string, unknown>;
	} catch (error) {
		entry.reject(toError(error, "Invalid JSON reply from computer-server"));
		return;
	}
	if (reply.success === false) {
		const detail =
			typeof reply.error === "string" ? reply.error : "unknown error";
		entry.reject(
			new Error(`computer-server "${entry.command}" failed: ${detail}`)
		);
		return;
	}
	entry.resolve(reply);
}

function wireSocket(
	state: ClientState,
	ws: WebSocketLike,
	resolve: () => void,
	reject: (error: Error) => void
): void {
	const timer = setTimeout(() => {
		reject(new Error(`computer-server connection to ${state.url} timed out`));
		safeClose(ws);
	}, CONNECT_TIMEOUT_MS);
	ws.onopen = () => {
		clearTimeout(timer);
		state.socket = ws;
		resolve();
	};
	ws.onerror = (event) => {
		clearTimeout(timer);
		const error = toError(
			event,
			`computer-server connection to ${state.url} failed`
		);
		failAll(state, error);
		reject(error);
	};
	ws.onmessage = (event) => handleMessage(state, event.data);
	ws.onclose = () => {
		state.socket = null;
		failAll(state, new Error("computer-server connection closed"));
	};
}

function connect(state: ClientState): Promise<void> {
	if (state.socket) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		const Ctor = resolveWebSocketCtor(state.wsImpl);
		wireSocket(state, new Ctor(state.url), resolve, reject);
	});
}

function sendCommand(
	state: ClientState,
	command: string,
	params?: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const active = state.socket;
	if (!active) {
		return Promise.reject(new Error("computer-server client is not connected"));
	}
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		const timer = setTimeout(() => {
			removePending(state, entry);
			reject(new Error(`computer-server command "${command}" timed out`));
		}, state.requestTimeoutMs);
		const entry: PendingRequest = { command, reject, resolve, timer };
		state.pending.push(entry);
		try {
			active.send(JSON.stringify({ command, params: params ?? {} }));
		} catch (error) {
			clearTimeout(timer);
			removePending(state, entry);
			reject(toError(error, `failed to send "${command}"`));
		}
	});
}

function closeClient(state: ClientState): void {
	const active = state.socket;
	state.socket = null;
	failAll(state, new Error("computer-server client closed"));
	safeClose(active);
}

export function createComputerServerClient(
	options: CreateComputerServerClientOptions
): ComputerServerClient {
	const state: ClientState = {
		pending: [],
		requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		socket: null,
		url: options.url,
		wsImpl: options.wsImpl,
	};
	return {
		close: () => closeClient(state),
		connect: () => connect(state),
		send: (command, params) => sendCommand(state, command, params),
	};
}
