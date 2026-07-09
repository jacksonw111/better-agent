// Transport plumbing for the `opencode serve` adapter (opencode-serve.ts):
// discovering the spawned server's listen URL, a thin JSON-over-fetch helper,
// and a minimal line-based SSE reader for `GET /event`. Split out of
// opencode-serve.ts purely to keep both files under the repo's max-lines
// gate. Wire-shape assumptions are marked ASSUMPTION (unverified) — no
// `opencode` binary was available to verify against.

import type { NormalizedEvent } from "../normalize/types";
import type { ProcessIo } from "./process-io";

/** How long to wait for the spawned server to print its listen URL. */
const SERVE_URL_TIMEOUT_MS = 15_000;

/** How long any single SHORT control-call request to the serve process may
 * take before it's aborted — a hung `opencode serve` (TCP connection open, no
 * response) must never leave `getStatus`/`setModel`/`interrupt`/an approval
 * reply waiting forever on a `fetch` that never settles. Same order of
 * magnitude as `SERVE_URL_TIMEOUT_MS` above.
 *
 * RC-T5: deliberately NOT applied to the long-running turn POST
 * (`POST /session/:id/message`, made via `firePost` with `timeoutMs: null` in
 * opencode-serve.ts's `makeServeControls.send`) — that call blocks until the
 * turn actually finishes (which routinely exceeds 15s once tool calls or
 * thinking are involved), while progress is already streaming in over
 * `pumpServeEvents`'s SSE connection below. A genuinely wedged turn is
 * covered by the RC-T5 activity watchdog (session-watchdog.ts), not this
 * timeout. */
const REQUEST_TIMEOUT_MS = 15_000;

/** ASSUMPTION (unverified): `opencode serve --port 0 --hostname 127.0.0.1`
 * binds an OS-assigned free port and prints a line containing the actual URL,
 * e.g. `opencode server listening on http://127.0.0.1:54321`. We don't rely
 * on the exact wording — any http(s)://host:port token on stdout OR stderr
 * (unverified which stream it lands on) is taken as the base URL. */
const SERVE_URL_PATTERN = /https?:\/\/[\w.-]+:\d+/;

async function firstServeUrl(lines: AsyncIterable<string>): Promise<string> {
	for await (const line of lines) {
		const match = SERVE_URL_PATTERN.exec(line);
		if (match) {
			return match[0];
		}
	}
	throw new Error("opencode serve exited before printing its listen URL");
}

/** Scans the child's stdout AND stderr for the first URL-looking token, with
 * a timeout so a silently-hung server can't stall `start()` forever. */
export async function waitForServeUrl(io: ProcessIo): Promise<string> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`opencode serve printed no listen URL within ${SERVE_URL_TIMEOUT_MS}ms`
					)
				),
			SERVE_URL_TIMEOUT_MS
		);
	});
	const scan = Promise.any([
		firstServeUrl(io.lines),
		firstServeUrl(io.stderrLines),
	]).catch(() => {
		// Both streams closed without a URL — flatten the AggregateError.
		throw new Error("opencode serve exited before printing its listen URL");
	});
	try {
		return await Promise.race([scan, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

// --- HTTP --------------------------------------------------------------------

/** `undefined` means "take this `ServeHttp`'s default (`REQUEST_TIMEOUT_MS`)
 * for a short control call"; `null` means "no deadline at all" — for the
 * long-running turn POST, where progress comes via SSE and a genuinely
 * wedged turn is the RC-T5 activity watchdog's job, not this timeout's. */
export type RequestTimeoutOverride = number | null | undefined;

export interface ServeHttp {
	baseUrl: string;
	getJson(path: string, timeoutMs?: RequestTimeoutOverride): Promise<unknown>;
	headers: Record<string, string>;
	postJson(
		path: string,
		body?: unknown,
		timeoutMs?: RequestTimeoutOverride
	): Promise<unknown>;
}

/** Resolves `timeoutMs === undefined` (no per-call override — take the
 * `ServeHttp`'s own default) to `requestTimeoutMs`, leaving `null` (no
 * deadline at all) and an explicit override untouched. Split out purely to
 * keep `createServeHttp`'s inner `requestJson` under the line gate. */
function resolveRequestTimeout(
	timeoutMs: RequestTimeoutOverride,
	requestTimeoutMs: number
): number | null {
	return timeoutMs === undefined ? requestTimeoutMs : timeoutMs;
}

/** Issues one request and parses its JSON body — split out of
 * `createServeHttp` purely to keep that function under the line gate. */
async function fetchJson(
	url: string,
	init: { body?: string; method: string },
	headers: Record<string, string>,
	effectiveTimeoutMs: number | null
): Promise<unknown> {
	const response = await fetch(url, {
		...init,
		headers,
		// `null` → no AbortSignal at all: this fetch waits as long as the
		// server takes, same as `pumpServeEvents`'s SSE connection.
		signal:
			effectiveTimeoutMs === null
				? undefined
				: AbortSignal.timeout(effectiveTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(
			`opencode serve ${init.method} ${url} → HTTP ${response.status}`
		);
	}
	// Biome's formatter strips an explicit `return undefined;` back to a bare
	// `return;`, which then trips ESLint's `consistent-return` (this function's
	// happy path returns a value) — assigning through a local sidesteps the
	// fight between the two linters.
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = undefined; // empty/non-JSON body — callers only care for a few routes
	}
	return body;
}

function buildServeHeaders(
	password: string | undefined
): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (password !== undefined && password !== "") {
		// ASSUMPTION (unverified): a server started with OPENCODE_SERVER_PASSWORD
		// set (the spawned child inherits our env) expects it as a bearer token.
		headers.authorization = `Bearer ${password}`;
	}
	return headers;
}

export function createServeHttp(
	baseUrl: string,
	password: string | undefined,
	// Overridable purely so tests can exercise the timeout path without a real
	// multi-second wait — production callers always take the default.
	requestTimeoutMs: number = REQUEST_TIMEOUT_MS
): ServeHttp {
	const headers = buildServeHeaders(password);
	const requestJson = (
		path: string,
		init: { body?: string; method: string },
		timeoutMs: RequestTimeoutOverride
	): Promise<unknown> =>
		fetchJson(
			`${baseUrl}${path}`,
			init,
			headers,
			resolveRequestTimeout(timeoutMs, requestTimeoutMs)
		);
	return {
		baseUrl,
		headers,
		getJson: (path, timeoutMs) =>
			requestJson(path, { method: "GET" }, timeoutMs),
		postJson: (path, body, timeoutMs) =>
			requestJson(
				path,
				{
					method: "POST",
					body: body === undefined ? undefined : JSON.stringify(body),
				},
				timeoutMs
			),
	};
}

export interface EventSink {
	close(): void;
	push(event: NormalizedEvent): void;
}

/** Fire-and-forget POST whose failure surfaces as an `error` event instead of
 * an unhandled rejection. `timeoutMs` is forwarded to `postJson` verbatim —
 * pass `null` for the long-running turn POST (see `RequestTimeoutOverride`). */
export function firePost(
	http: ServeHttp,
	path: string,
	body: unknown,
	events: EventSink,
	timeoutMs?: RequestTimeoutOverride
): void {
	http.postJson(path, body, timeoutMs).catch((error: unknown) => {
		events.push({
			kind: "error",
			message: `opencode serve POST ${path} failed`,
			detail: error instanceof Error ? error.message : error,
		});
	});
}

// --- SSE ---------------------------------------------------------------------

const TRAILING_CR = /\r$/;
const DATA_FIELD_PREFIX = "data:";

/** A minimal line-based SSE parser: feed it decoded chunks, it invokes
 * `onData` with each frame's JSON-parsed `data:` payload. Non-JSON frames and
 * non-`data:` fields (event:/id:/retry:/comments) are ignored. */
function createSseFeed(
	onData: (data: unknown) => void
): (chunk: string) => void {
	let buffer = "";
	let dataLines: string[] = [];
	const handleLine = (line: string): void => {
		if (line === "") {
			if (dataLines.length === 0) {
				return;
			}
			const payload = dataLines.join("\n");
			dataLines = [];
			try {
				onData(JSON.parse(payload));
			} catch {
				// non-JSON data frame — skip
			}
			return;
		}
		if (line.startsWith(DATA_FIELD_PREFIX)) {
			dataLines.push(line.slice(DATA_FIELD_PREFIX.length).trimStart());
		}
	};
	return (chunk: string): void => {
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			handleLine(buffer.slice(0, newline).replace(TRAILING_CR, ""));
			buffer = buffer.slice(newline + 1);
			newline = buffer.indexOf("\n");
		}
	};
}

/** Opens the server-global `GET /event` SSE stream and feeds each frame's
 * parsed `data:` payload to `onData` until the stream ends or `signal`
 * aborts. */
export async function pumpServeEvents(
	http: ServeHttp,
	signal: AbortSignal,
	onData: (data: unknown) => void
): Promise<void> {
	const response = await fetch(`${http.baseUrl}/event`, {
		headers: http.headers,
		signal,
	});
	if (!response.ok) {
		throw new Error(`opencode serve GET /event → HTTP ${response.status}`);
	}
	if (response.body === null) {
		throw new Error("opencode serve GET /event returned no body");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const feed = createSseFeed(onData);
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return;
		}
		feed(decoder.decode(value, { stream: true }));
	}
}
