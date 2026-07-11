import { describe, expect, it, vi } from "vitest";
import {
	CODEX_THREAD_RESUME_TIMEOUT_MS,
	resumeFailedEvent,
	type ThreadResumeRpc,
	threadIdFrom,
	tryCodexThreadResume,
} from "./codex-resume";

function fakeRpc(request: ThreadResumeRpc["request"]): ThreadResumeRpc {
	return { request };
}

describe("tryCodexThreadResume", () => {
	it("resolves the resumed thread id from a well-formed thread/resume result", async () => {
		const rpc = fakeRpc((method, params) => {
			expect(method).toBe("thread/resume");
			expect(params).toEqual({ threadId: "prior_thread" });
			return Promise.resolve({ thread: { id: "resumed_thread" } });
		});

		await expect(tryCodexThreadResume(rpc, "prior_thread")).resolves.toEqual({
			threadId: "resumed_thread",
		});
	});

	it("falls back through the same multi-key extraction thread/start uses", async () => {
		const rpc = fakeRpc(() => Promise.resolve({ sessionId: "resumed_2" }));

		await expect(tryCodexThreadResume(rpc, "prior")).resolves.toEqual({
			threadId: "resumed_2",
		});
	});

	it("yields a failure reason when the RPC rejects", async () => {
		const rpc = fakeRpc(() => Promise.reject(new Error("thread gone")));

		const result = await tryCodexThreadResume(rpc, "prior");
		expect(result).toHaveProperty("reason", "thread gone");
	});

	it("yields a failure reason when the result carries no usable thread id", async () => {
		const rpc = fakeRpc(() => Promise.resolve({ irrelevant: true }));

		const result = await tryCodexThreadResume(rpc, "prior");
		expect("reason" in result).toBe(true);
	});

	it("yields a failure reason when the RPC never resolves within the timeout", async () => {
		vi.useFakeTimers();
		try {
			const rpc = fakeRpc(() => new Promise(() => undefined));
			const pending = tryCodexThreadResume(rpc, "prior");
			await vi.advanceTimersByTimeAsync(CODEX_THREAD_RESUME_TIMEOUT_MS);
			const result = await pending;
			expect("reason" in result).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("threadIdFrom", () => {
	it("prefers thread.id over every other key", () => {
		expect(
			threadIdFrom({
				thread: { id: "a" },
				sessionId: "b",
				threadId: "c",
			})
		).toBe("a");
	});

	it("returns null for a non-record result", () => {
		expect(threadIdFrom(null)).toBeNull();
		expect(threadIdFrom("not-an-object")).toBeNull();
	});
});

describe("resumeFailedEvent", () => {
	it("builds a resume_failed status event carrying the reason", () => {
		expect(resumeFailedEvent("timed out")).toEqual({
			kind: "status",
			status: "resume_failed",
			detail: { reason: "timed out" },
		});
	});
});
