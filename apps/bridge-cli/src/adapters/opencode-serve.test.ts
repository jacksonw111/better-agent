import { afterEach, describe, expect, it, vi } from "vitest";
import { messageCalls, startServe } from "./opencode-serve-test-support";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

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
