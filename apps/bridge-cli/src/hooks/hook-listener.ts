import { mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { mapHookEventToState } from "./hook-state";

// Observability slice B: the CLI daemon's end of the hook channel. It listens on
// the local unix socket (hook-paths.ts) that each short-lived `hook-emit`
// subprocess connects to, turns each event line into an activity_state, and
// hands it to `sendState` — which the pty transport wires to a STATE frame over
// the already-authenticated multiplexed WS.
//
// Note (codex): this covers claude only — codex has no hooks (spike confirmed),
// so its coarse state still rides the existing ACTIVITY/CLOSE frames. Nothing
// here emits for codex sessions.

const NEWLINE = /\r?\n/;

/** One decoded hook line: the pty session id + the event name. */
interface HookLine {
	event?: unknown;
	sessionId?: unknown;
}

/**
 * Handles one received event line: parse → map to a state → emit. Exported so
 * the mapping/emit path is unit-tested without any sockets. A malformed line,
 * an unknown event, or a missing sessionId emits nothing (version tolerance).
 *
 * The sessionId is claude's session_id, which P25-C pinned to our pty id, so it
 * is forwarded verbatim: the server's setActivityState is a keyed update that
 * no-ops on an unknown row, so passing an id we no longer hold is harmless and
 * keeps this side dead simple.
 */
export function handleHookLine(
	line: string,
	sendState: (sessionId: string, state: string) => void
): void {
	const trimmed = line.trim();
	if (trimmed === "") {
		return;
	}
	let parsed: HookLine;
	try {
		parsed = JSON.parse(trimmed) as HookLine;
	} catch {
		return;
	}
	if (
		typeof parsed.event !== "string" ||
		typeof parsed.sessionId !== "string"
	) {
		return;
	}
	const state = mapHookEventToState(parsed.event);
	if (state) {
		sendState(parsed.sessionId, state);
	}
}

export interface HookListenerDeps {
	log?: (message: string) => void;
	/** Emits the mapped state for a session (→ a STATE frame in production). */
	sendState: (sessionId: string, state: string) => void;
	socketPath: string;
}

export interface HookListener {
	close(): void;
}

function onConnection(
	conn: Socket,
	sendState: (sessionId: string, state: string) => void
): void {
	let buffer = "";
	conn.setEncoding("utf8");
	conn.on("data", (chunk: string) => {
		buffer += chunk;
	});
	conn.on("error", () => conn.destroy());
	conn.on("end", () => {
		for (const line of buffer.split(NEWLINE)) {
			handleHookLine(line, sendState);
		}
	});
}

function removeStale(socketPath: string): void {
	try {
		unlinkSync(socketPath);
	} catch {
		// No stale socket (or not removable) — the listen call will report a real
		// bind failure below.
	}
}

/**
 * Starts the daemon's hook listener on `socketPath`: unlinks any stale socket,
 * ensures the parent dir exists, and binds. Best-effort — a bind failure is
 * logged, not thrown (observability is auxiliary; it must never take the daemon
 * down). `close()` stops the server and removes the socket file.
 */
export function startHookListener(deps: HookListenerDeps): HookListener {
	let server: Server | null = null;
	try {
		mkdirSync(dirname(deps.socketPath), { recursive: true });
		removeStale(deps.socketPath);
		server = createServer((conn) => onConnection(conn, deps.sendState));
		server.on("error", (error) => {
			deps.log?.(`hook listener error: ${error.message}`);
		});
		server.listen(deps.socketPath);
	} catch (error) {
		deps.log?.(
			`hook listener failed to start: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	return {
		close() {
			server?.close();
			removeStale(deps.socketPath);
		},
	};
}
