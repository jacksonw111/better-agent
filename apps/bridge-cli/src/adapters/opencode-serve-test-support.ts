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

/** Mutable canned response for `GET /agent` (R2-T3 item 7) — defaults to a
 * realistic mixed list (two selectable `primary` agents, one `subagent` that
 * must be filtered out) so the DEFAULT case exercises real parsing, not just
 * the `SERVE_AGENT_FALLBACK` path; tests reassign `agentBody` to cover the
 * fallback (empty/malformed response) and failure cases. */
function createAgentRoute() {
	return {
		agentBody: [
			{ name: "build", mode: "primary" },
			{ name: "plan", mode: "primary" },
			{ name: "reviewer", mode: "subagent" },
		] as unknown,
		agentOk: true,
	};
}

/** Mutable canned response for `GET /global/health` (R2-T3 item 6). */
function createHealthRoute() {
	return {
		healthBody: { healthy: true, version: "0.80.6" } as unknown,
		healthOk: true,
	};
}

/** Mutable canned response for `GET /command` (R5-T1) — defaults to empty so
 * existing tests (predating command_catalog) see no catalog event; tests that
 * care reassign `commandsBody`. */
function createCommandsRoute() {
	return { commandsBody: [] as unknown, commandsOk: true };
}

/** Bundles the mutable canned-response fixtures into one object, purely so
 * `routeResponse` stays within the repo's max-params gate. */
interface FakeRoutes {
	agents: ReturnType<typeof createAgentRoute>;
	commands: ReturnType<typeof createCommandsRoute>;
	health: ReturnType<typeof createHealthRoute>;
	messages: ReturnType<typeof createMessageRoute>;
}

/** The GET-only routes with a mutable canned response — split out of
 * `routeResponse` purely to keep its complexity under the lint gate. */
function routeGetResponse(
	url: string,
	routes: FakeRoutes
): Response | undefined {
	if (url.endsWith("/config/providers")) {
		return Response.json({
			providers: [{ id: "anthropic", models: { "claude-sonnet-4": {} } }],
		});
	}
	if (url.endsWith("/agent")) {
		return routes.agents.agentOk
			? Response.json(routes.agents.agentBody)
			: new Response(null, { status: 500 });
	}
	if (url.endsWith("/global/health")) {
		return routes.health.healthOk
			? Response.json(routes.health.healthBody)
			: new Response(null, { status: 404 });
	}
	if (url.endsWith("/command")) {
		return routes.commands.commandsOk
			? Response.json(routes.commands.commandsBody)
			: new Response(null, { status: 404 });
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** Picks the canned response for one fake-server route — split out of
 * `createFakeServer`'s `fetchImpl` purely to keep that arrow function's
 * complexity under the lint gate. */
function routeResponse(
	url: string,
	method: string,
	stream: ReadableStream<Uint8Array>,
	routes: FakeRoutes
): Promise<Response> {
	if (url.endsWith("/event")) {
		return Promise.resolve(new Response(stream));
	}
	if (method === "POST" && url.endsWith("/session")) {
		return Promise.resolve(Response.json({ id: "ses_1" }));
	}
	const getResponse = routeGetResponse(url, routes);
	if (getResponse !== undefined) {
		return Promise.resolve(getResponse);
	}
	if (url.endsWith("/session/ses_1/message")) {
		return routes.messages.messageOk
			? Promise.resolve(Response.json(routes.messages.messageBody))
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
	const routes: FakeRoutes = {
		agents: createAgentRoute(),
		commands: createCommandsRoute(),
		health: createHealthRoute(),
		messages: createMessageRoute(),
	};
	const { agents, commands, health, messages } = routes;
	const fetchImpl = vi.fn((input: string | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ body, method, url });
		return routeResponse(url, method, stream, routes);
	});
	return {
		agents,
		calls,
		commands,
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
		health,
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

/** `configure` runs on the fixture right after it's built but BEFORE
 * `opencodeServeAdapter.start()` fires — the only way to steer a canned
 * response (e.g. R5-T1's `/command` catalog) away from its default, since
 * `start()`'s health-probe `Promise.all` reads every route synchronously on
 * the way in. */
export async function startServe(
	configure?: (server: ReturnType<typeof createFakeServer>) => void
) {
	const server = createFakeServer();
	configure?.(server);
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
