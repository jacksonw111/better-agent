import { createConnection } from "node:net";
import { hookSocketPath } from "./hook-paths";

// Observability slice B: the `agent-cli hook-emit <Event>` subcommand. claude
// spawns this as a short-lived subprocess for each hook event; it has NO server
// connection or computer key. Its whole job: read the hook JSON on stdin, and
// hand one compact line to the CLI daemon over the local unix socket, then exit.
//
// STRICTLY fire-and-forget: the socket missing / unreachable / a write failing /
// malformed stdin / ANY error must resolve cleanly (exit 0) and write NOTHING to
// stderr — a hook that fails must never disturb claude (spike: exit 0 = pure
// bypass). A hard timeout guards against a hung connect so claude never blocks.

const DEFAULT_TIMEOUT_MS = 500;

/** The hook event JSON claude pipes on stdin. Only these keys are read; every
 * event carries `session_id` (== our pty id), and some carry `source`/`reason`. */
interface HookStdinPayload {
	reason?: unknown;
	session_id?: unknown;
	source?: unknown;
}

/** The minimal socket surface hook-emit drives (injectable for tests). */
export interface HookEmitConn {
	destroy(): void;
	end(data: string): void;
	on(event: "connect" | "error", listener: () => void): void;
}

export interface HookEmitDeps {
	/** Opens the client connection to `socketPath` — real `net` in production. */
	connect: (socketPath: string) => HookEmitConn;
	/** Reads the hook JSON piped on stdin (whole stream, resolved to a string). */
	readStdin: () => Promise<string>;
	setTimeoutFn?: typeof setTimeout;
	socketPath?: string;
	timeoutMs?: number;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Builds the one-line message from the stdin JSON + the argv event name, or
 * null when there is nothing worth reporting (no parseable session id). */
function buildLine(event: string, stdin: string): string | null {
	let payload: HookStdinPayload;
	try {
		payload = JSON.parse(stdin) as HookStdinPayload;
	} catch {
		return null;
	}
	const sessionId = optionalString(payload.session_id);
	if (!sessionId) {
		return null;
	}
	const line: Record<string, string> = { sessionId, event };
	const source = optionalString(payload.source);
	if (source) {
		line.source = source;
	}
	const reason = optionalString(payload.reason);
	if (reason) {
		line.reason = reason;
	}
	return `${JSON.stringify(line)}\n`;
}

/** Connects and writes the line, resolving on connect-write / error / timeout —
 * never rejects. */
function deliver(
	line: string,
	deps: Required<Pick<HookEmitDeps, "socketPath" | "timeoutMs">> & HookEmitDeps
): Promise<void> {
	const scheduleTimeout = deps.setTimeoutFn ?? setTimeout;
	return new Promise<void>((resolve) => {
		let settled = false;
		const finish = (conn?: HookEmitConn) => {
			if (settled) {
				return;
			}
			settled = true;
			conn?.destroy();
			resolve();
		};
		try {
			const conn = deps.connect(deps.socketPath);
			const timer = scheduleTimeout(() => finish(conn), deps.timeoutMs);
			if (typeof (timer as { unref?: () => void }).unref === "function") {
				(timer as { unref: () => void }).unref();
			}
			conn.on("error", () => finish());
			conn.on("connect", () => {
				try {
					conn.end(line);
				} catch {
					// ignore — nothing more we can do; still exit 0.
				}
				finish();
			});
		} catch {
			finish();
		}
	});
}

/**
 * Runs one `hook-emit <event>`: read stdin, and if it names a session, deliver
 * the line to the daemon socket. Always resolves (exit 0), never throws, never
 * writes to stderr.
 */
export async function runHookEmit(
	event: string,
	deps: HookEmitDeps
): Promise<void> {
	try {
		const stdin = await deps.readStdin();
		const line = buildLine(event, stdin);
		if (!line) {
			return;
		}
		await deliver(line, {
			...deps,
			socketPath: deps.socketPath ?? hookSocketPath(),
			timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
	} catch {
		// Swallow everything — a hook must never disturb claude.
	}
}

/** Reads the whole of a readable stream (default `process.stdin`) as UTF-8. */
export function readStreamToString(
	stream: NodeJS.ReadableStream = process.stdin
): Promise<string> {
	return new Promise<string>((resolve) => {
		const chunks: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
		stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		stream.on("error", () => resolve(""));
	});
}

/** Production deps: real `net` client + real stdin reader. */
export function defaultHookEmitDeps(): HookEmitDeps {
	return {
		connect: (socketPath) =>
			createConnection(socketPath) as unknown as HookEmitConn,
		readStdin: () => readStreamToString(process.stdin),
	};
}
