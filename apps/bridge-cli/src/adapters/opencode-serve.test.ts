import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { opencodeServeAdapter } from "./opencode-serve";
import type { ProcessExitInfo, ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

const BASE_URL = "http://127.0.0.1:4242";

interface RecordedCall {
	body: unknown;
	method: string;
	url: string;
}

/** A fake `opencode serve` HTTP surface: records every fetch, answers the
 * routes the adapter hits, and lets the test push SSE frames onto the
 * `GET /event` stream it hands out. */
function createFakeServer() {
	const calls: RecordedCall[] = [];
	let sse: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			sse = controller;
		},
	});
	const encoder = new TextEncoder();
	const fetchImpl = vi.fn((input: string | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ body, method, url });
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
		return Promise.resolve(Response.json({}));
	});
	return {
		calls,
		emitSse(data: unknown): void {
			sse?.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
		},
		fetchImpl,
	};
}

/** A fake `ProcessIo` standing in for the spawned `opencode serve` child. */
function createFakeIo() {
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

async function startServe() {
	const server = createFakeServer();
	const fake = createFakeIo();
	vi.mocked(spawnProcessIo).mockResolvedValue(fake.io);
	vi.stubGlobal("fetch", server.fetchImpl);
	fake.stdout.push(`opencode server listening on ${BASE_URL}`);
	const handle = await opencodeServeAdapter.start("/tmp/project");
	return { fake, handle, server };
}

function messageCalls(server: { calls: RecordedCall[] }): RecordedCall[] {
	return server.calls.filter((call) =>
		call.url.endsWith("/session/ses_1/message")
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("opencodeServeAdapter - start", () => {
	it("spawns serve on a free port, creates a session, and emits session_ready with models", async () => {
		const { handle } = await startServe();

		expect(spawnProcessIo).toHaveBeenCalledExactlyOnceWith(
			"opencode",
			["serve", "--port", "0", "--hostname", "127.0.0.1"],
			"/tmp/project"
		);
		const { value: ready } = await handle.events[Symbol.asyncIterator]().next();
		expect(ready).toEqual({
			kind: "status",
			status: "session_ready",
			detail: {
				cwd: "/tmp/project",
				sessionId: "ses_1",
				models: ["anthropic/claude-sonnet-4"],
			},
		});
	});

	it("routes SSE /event frames through the normalizer onto events", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.emitSse({
			type: "message.part.updated",
			properties: {
				part: { id: "prt_1", sessionID: "ses_1", type: "text", text: "hi" },
			},
		});

		const { value: event } = await iterator.next();
		expect(event).toEqual({ kind: "output", text: "hi", reasoning: false });
	});
});

describe("opencodeServeAdapter - send & model", () => {
	it("echoes the user message and posts the prompt parts", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		handle.send("do it");

		const { value: echoed } = await iterator.next();
		expect(echoed).toEqual({ kind: "message", role: "user", text: "do it" });
		expect(messageCalls(server)[0]).toMatchObject({
			method: "POST",
			body: { parts: [{ type: "text", text: "do it" }] },
		});
	});

	it("rides the stored model on prompts after setModel", async () => {
		const { handle, server } = await startServe();

		handle.setModel?.("anthropic/claude-sonnet-4");
		handle.send("again");

		expect(messageCalls(server)[0]?.body).toEqual({
			parts: [{ type: "text", text: "again" }],
			model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
		});
	});

	it("emits a status and keeps prompts model-less for a model id without a provider prefix", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		handle.setModel?.("gibberish");

		const { value: warning } = await iterator.next();
		expect(warning).toMatchObject({
			kind: "status",
			status: "model_format_invalid",
		});
		handle.send("go");
		const [call] = messageCalls(server);
		expect(call?.body).toEqual({ parts: [{ type: "text", text: "go" }] });
	});
});

describe("opencodeServeAdapter - interrupt & approvals", () => {
	it("posts /abort on interrupt", async () => {
		const { handle, server } = await startServe();

		handle.interrupt?.();

		const abort = server.calls.find((call) =>
			call.url.endsWith("/session/ses_1/abort")
		);
		expect(abort?.method).toBe("POST");
	});

	it("surfaces a permission.updated frame as an approval and posts the picked response", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.emitSse({
			type: "permission.updated",
			properties: { id: "perm_1", sessionID: "ses_1", title: "Run `ls`" },
		});

		const { value: approval } = await iterator.next();
		expect(approval).toMatchObject({
			kind: "approval",
			requestId: "perm_1",
			title: "Run `ls`",
		});

		handle.answerApproval("perm_1", "once");
		const reply = server.calls.find((call) =>
			call.url.endsWith("/session/ses_1/permissions/perm_1")
		);
		expect(reply).toMatchObject({ method: "POST", body: { response: "once" } });
	});
});

describe("opencodeServeAdapter - lifecycle", () => {
	it("pushes agent_exited and closes events when the process exits on its own", async () => {
		const { fake, handle } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		fake.triggerExit({ code: 1, signal: null });

		const { value: status } = await iterator.next();
		expect(status).toEqual({ kind: "status", status: "agent_exited" });
		const { done } = await iterator.next();
		expect(done).toBe(true);
	});

	it("kills the serve process and closes events on stop", async () => {
		const { fake, handle } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		handle.stop();

		expect(fake.io.stop).toHaveBeenCalledOnce();
		const { done } = await iterator.next();
		expect(done).toBe(true);
	});
});
