// R5-T1: codex's `thread/resume` — the restart chain's context-preserving
// path — split out of codex.ts purely to keep that file under the repo's
// 300-line limit; mirrors codex-models.ts's fetch/fallback-with-timeout
// shape (`fetchCodexModelList`).

import { asString, isRecord, type NormalizedEvent } from "../normalize/types";

/** codex's app-server response key for a thread id has drifted across
 * versions — some builds nest it at `thread.id` or `thread.sessionId`,
 * others flatten it to a top-level `sessionId` or `threadId`. Tries each in
 * turn (first non-empty string wins), shared by both `thread/start` and
 * `thread/resume` results (codex.ts / this module).
 *
 * ASSUMPTION (unverified — no `codex` binary in this sandbox): the exact set
 * of alternate keys. Mirrors hermes's `codex_app_server_session.py`
 * (`thread.id` / `thread.sessionId` / `sessionId` / `threadId`), which
 * verified this cross-version drift against a real codex 0.130.0 binary.
 */
export function threadIdFrom(result: unknown): unknown {
	if (!isRecord(result)) {
		return null;
	}
	const thread = isRecord(result.thread) ? result.thread : undefined;
	return (
		asString(thread?.id) ??
		asString(thread?.sessionId) ??
		asString(result.sessionId) ??
		asString(result.threadId) ??
		null
	);
}

/** How long `thread/resume` may take before giving up and falling back to a
 * fresh `thread/start` — short (mirrors `CODEX_MODEL_LIST_TIMEOUT_MS`) since
 * a stuck resume attempt must never leave a restarted session's `start()`
 * hanging. */
export const CODEX_THREAD_RESUME_TIMEOUT_MS = 2000;

/** Minimal shape `tryCodexThreadResume` needs off `JsonRpcIo` — kept
 * structural so tests can hand in a plain mock (mirrors `ModelListRpc`). */
export interface ThreadResumeRpc {
	request(method: string, params: unknown): Promise<unknown>;
}

/** Either the resumed thread id, or a human-readable reason the attempt
 * failed — NEVER a rejection (see `tryCodexThreadResume`'s doc comment). */
export type ThreadResumeAttempt = { reason: string } | { threadId: unknown };

function resumeErrorReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Tries codex's `thread/resume` RPC for a prior thread id (captured off a
 * previous `session_ready` — see `capture-agent-session-id.ts`), resolving
 * (never rejecting, never hanging) within `CODEX_THREAD_RESUME_TIMEOUT_MS`
 * either with the resumed thread id or a failure reason — the caller
 * (codex.ts's `resolveCodexThreadId`) falls back to a fresh `thread/start`
 * on the latter and pushes a visible `resume_failed` status.
 *
 * ASSUMPTION (unverified — no `codex` binary in this sandbox): the request
 * name itself ("thread/resume") and its params shape (`{threadId}`) — hermes
 * lists `thread/resume` as a codex app-server capability, but the exact wire
 * hasn't been confirmed against a real binary.
 */
export function tryCodexThreadResume(
	rpc: ThreadResumeRpc,
	resumeId: string
): Promise<ThreadResumeAttempt> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<ThreadResumeAttempt>((resolve) => {
		timer = setTimeout(() => {
			resolve({
				reason: `thread/resume timed out after ${CODEX_THREAD_RESUME_TIMEOUT_MS}ms`,
			});
		}, CODEX_THREAD_RESUME_TIMEOUT_MS);
	});
	const attempt = rpc
		.request("thread/resume", { threadId: resumeId })
		.then((result): ThreadResumeAttempt => {
			const threadId = threadIdFrom(result);
			return threadId === null
				? { reason: "thread/resume returned no thread id" }
				: { threadId };
		})
		.catch(
			(error: unknown): ThreadResumeAttempt => ({
				reason: resumeErrorReason(error),
			})
		)
		.finally(() => clearTimeout(timer));
	return Promise.race([attempt, timeout]);
}

/** Builds the visible `resume_failed` status event pushed when
 * `tryCodexThreadResume` gives up — the web maps this status to "无法恢复
 * 上下文，已开启新会话" (`status-line.tsx`'s `STATUS_NOTICES`, warn tone), so
 * the user knows the fresh session lost the prior conversation's context. */
export function resumeFailedEvent(reason: string): NormalizedEvent {
	return { kind: "status", status: "resume_failed", detail: { reason } };
}
