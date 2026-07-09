// Shared fake `opencode serve` HTTP/process-io test doubles, used by both
// opencode-serve.test.ts and opencode-serve-status.test.ts — split into its
// own module purely so neither spec file trips the repo's 300-line file cap.
// Callers must still call `vi.mock("./process-io", () => ({ spawnProcessIo:
// vi.fn() }))` themselves at the top of their own spec file: vi.mock's
// hoisting is per-test-file, so it has to live where vitest actually loads it,
// but it still intercepts every import of `./process-io` reached transitively
// from that file — including the `startServe` call below.

import { vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { opencodeServeAdapter } from "./opencode-serve";
import type { ProcessExitInfo, ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

export const BASE_URL = "http://127.0.0.1:4242";

export interface RecordedCall {
	body: unknown;
	method: string;
	url: string;
}

/** Mutable canned response for `GET /session/ses_1/message` — defaults to an
 * empty history; tests reassign `messageBody`/`messageOk` for the getStatus
 * fetch/fetch-failure cases. */
function createMessageRoute() {
	return { messageBody: [] as unknown, messageOk: true };
}

/** Picks the canned response for one fake-server route — split out of
 * `createFakeServer`'s `fetchImpl` purely to keep that arrow function's
 * complexity under the lint gate. */
function routeResponse(
	url: string,
	method: string,
	stream: ReadableStream<Uint8Array>,
	messages: ReturnType<typeof createMessageRoute>
): Promise<Response> {
	if (url.endsWith("/event")) {
		return Promise.resolve(new Response(stream));
	}
	if (method === "POST" && url.endsWith("/session")) {
		return Promise.resolve(Response.json({ id: "ses_1" }));
	}
	if (url.endsWith("/config/providers")) {
		return Promise.resolve(
			Response.json({
				providers: [{ id: "anthropic", models: { "claude-sonnet-4": {} } }],
			})
		);
	}
	if (url.endsWith("/session/ses_1/message")) {
		return messages.messageOk
			? Promise.resolve(Response.json(messages.messageBody))
			: Promise.resolve(new Response(null, { status: 500 }));
	}
	return Promise.resolve(Response.json({}));
}

/** A fake `opencode serve` HTTP surface: records every fetch, answers the
 * routes the adapter hits, and lets the test push SSE frames onto the
 * `GET /event` stream it hands out. */
export function createFakeServer() {
	const calls: RecordedCall[] = [];
	let sse: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			sse = controller;
		},
	});
	const encoder = new TextEncoder();
	const messages = createMessageRoute();
	const fetchImpl = vi.fn((input: string | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ body, method, url });
		return routeResponse(url, method, stream, messages);
	});
	return {
		calls,
		emitSse(data: unknown): void {
			sse?.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
		},
		// RC-T5: simulates a dead SSE reader — the server crashing or the
		// connection dropping mid-stream — so `pumpServeEvents`'s `reader.read()`
		// rejects, exercising `wireServeEventStream`'s dead-stream handling.
		errorSse(error: unknown): void {
			sse?.error(error);
		},
		fetchImpl,
		messages,
	};
}

/** A fake `ProcessIo` standing in for the spawned `opencode serve` child. */
export function createFakeIo() {
	const stdout = createAsyncQueue<string>();
	const stderr = createAsyncQueue<string>();
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const io: ProcessIo = {
		child: {} as unknown as ProcessIo["child"],
		lines: stdout,
		stderrLines: stderr,
		onExit(handler): void {
			exitHandlers.push(handler);
		},
		stop: vi.fn(),
		writeLine: vi.fn(),
	};
	return {
		io,
		stdout,
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
	};
}

export async function startServe() {
	const server = createFakeServer();
	const fake = createFakeIo();
	vi.mocked(spawnProcessIo).mockResolvedValue(fake.io);
	vi.stubGlobal("fetch", server.fetchImpl);
	fake.stdout.push(`opencode server listening on ${BASE_URL}`);
	const handle = await opencodeServeAdapter.start("/tmp/project");
	return { fake, handle, server };
}

export function messageCalls(server: {
	calls: RecordedCall[];
}): RecordedCall[] {
	return server.calls.filter((call) =>
		call.url.endsWith("/session/ses_1/message")
	);
}
