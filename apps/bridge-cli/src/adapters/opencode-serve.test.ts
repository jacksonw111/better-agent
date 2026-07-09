import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TIMEOUT_MS } from "./approvals";
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
			turnEpoch: 0,
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
		expect(event).toEqual({
			kind: "output",
			text: "hi",
			reasoning: false,
			turnEpoch: 0,
		});
	});
});

describe("opencodeServeAdapter - send & model", () => {
	it("echoes the user message and posts the prompt parts", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		handle.send("do it");

		const { value: echoed } = await iterator.next();
		expect(echoed).toEqual({
			kind: "message",
			role: "user",
			text: "do it",
			turnEpoch: 1,
		});
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

describe("opencodeServeAdapter - approvals never hang forever (RC-T4)", () => {
	it("an unanswered permission resolves declined via the shared timeout", async () => {
		vi.useFakeTimers();
		try {
			const { handle, server } = await startServe();
			const iterator = handle.events[Symbol.asyncIterator]();
			await iterator.next(); // session_ready

			server.emitSse({
				type: "permission.updated",
				properties: { id: "perm_3", sessionID: "ses_1", title: "Run `curl`" },
			});
			await iterator.next(); // the approval card

			await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);

			const reply = server.calls.find((call) =>
				call.url.endsWith("/session/ses_1/permissions/perm_3")
			);
			expect(reply).toMatchObject({
				method: "POST",
				body: { response: "reject" },
			});
			const { value: timeoutEvent } = await iterator.next();
			expect(timeoutEvent).toMatchObject({
				kind: "approval",
				cancelled: true,
				requestId: "perm_3",
				title: "Timed out — declined",
			});
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("opencodeServeAdapter - interrupt retracts approvals (RC-T3)", () => {
	it("retracts a pending approval and emits a cancelled event; a late answer is a no-op", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.emitSse({
			type: "permission.updated",
			properties: { id: "perm_2", sessionID: "ses_1", title: "Run `rm`" },
		});
		await iterator.next(); // the approval event

		handle.interrupt?.();
		const { value: retract } = await iterator.next();
		expect(retract).toEqual({
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "perm_2",
			title: "Cancelled",
			turnEpoch: 1,
		});

		// A late answer for the retracted request must never fire the
		// permissions POST — the registry no longer knows about it.
		handle.answerApproval("perm_2", "once");
		const reply = server.calls.find((call) =>
			call.url.endsWith("/session/ses_1/permissions/perm_2")
		);
		expect(reply).toBeUndefined();
	});
});

describe("opencodeServeAdapter - lifecycle", () => {
	it("pushes agent_exited and closes events when the process exits on its own", async () => {
		const { fake, handle } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		fake.triggerExit({ code: 1, signal: null });

		const { value: status } = await iterator.next();
		expect(status).toEqual({
			kind: "status",
			status: "agent_exited",
			turnEpoch: 0,
		});
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

	// RC-T5: a dead SSE reader (server crash, dropped connection) must not
	// leave the session hanging forever — it surfaces the same way a real
	// process exit does (an error event, then agent_exited, then the events
	// stream closes), so runBridgeSession's loop ends cleanly instead of
	// waiting on a stream that will never produce anything again.
	it("surfaces an error and agent_exited, then closes events, when the SSE stream dies", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.errorSse(new Error("stream reset"));

		const { value: errorEvent } = await iterator.next();
		expect(errorEvent).toMatchObject({
			kind: "error",
			message: "opencode serve /event stream failed",
		});
		const { value: exitedEvent } = await iterator.next();
		expect(exitedEvent).toEqual({
			kind: "status",
			status: "agent_exited",
			turnEpoch: 0,
		});
		const { done } = await iterator.next();
		expect(done).toBe(true);
	});
});

describe("opencodeServeAdapter - the turn POST has no request timeout (RC-T5)", () => {
	it("issues the turn POST with no abort signal, unlike a short control call", async () => {
		const { handle, server } = await startServe();

		handle.send("do it");
		handle.interrupt?.();

		// The turn POST (`POST /session/:id/message`) must carry NO abort signal
		// at all (opencode-serve-http.ts's `requestJson`: `timeoutMs: null` maps
		// to `signal: undefined`) — a slow-but-alive turn (tool calls, thinking)
		// routinely exceeds the short-control-call deadline, and progress
		// already streams in over SSE separately.
		const messageCall = server.fetchImpl.mock.calls.find(([input]) =>
			String(input).endsWith("/session/ses_1/message")
		);
		expect(messageCall?.[1]?.signal).toBeUndefined();

		// A short control call (interrupt's /abort POST), by contrast, still
		// gets a real deadline.
		const abortCall = server.fetchImpl.mock.calls.find(([input]) =>
			String(input).endsWith("/session/ses_1/abort")
		);
		expect(abortCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
	});
});
