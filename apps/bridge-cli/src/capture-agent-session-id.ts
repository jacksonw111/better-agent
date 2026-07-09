// Split out of relay-client.ts purely to keep that file under the repo's
// max-lines-per-file gate — mirrors poll-loop.ts.

import { isRecord } from "./normalize/types";

/** Status event `kind`/`status` an adapter pushes once per session-open,
 * carrying (among other things) the underlying agent's own conversation id
 * at `detail.sessionId` — see `normalizeClaudeCode`/`sessionInfo` in
 * `normalize/claude-code.ts`, the one adapter that fills it. */
const SESSION_READY_STATUS = "session_ready";

/** Mutable holder for the underlying agent's own conversation id, captured
 * from a `session_ready` status event's `detail.sessionId` as events stream
 * past — read by the outer restart loop (`restart-loop.ts`) after a
 * `"restart"` outcome so it can `--resume` the SAME agent conversation, not
 * just the same bridge sessionId. `current` stays `undefined` until (and
 * unless) the adapter emits its first `session_ready`; a restart falls back
 * to whatever `--resume` id the CLI was originally launched with. Mirrors
 * `AfterIdRef`'s "mutable ref the caller can read back" shape. */
export interface AgentSessionIdRef {
	current?: string;
}

/** Extracts `detail.sessionId` from a `session_ready` status event, or
 * `undefined` for anything else (including a `session_ready` with no
 * sessionId — pi/opencode's `session_ready` doesn't carry one). */
function sessionReadyId(event: unknown): string | undefined {
	const detail =
		isRecord(event) &&
		event.kind === "status" &&
		event.status === SESSION_READY_STATUS &&
		isRecord(event.detail)
			? event.detail
			: undefined;
	const sessionId = detail?.sessionId;
	return typeof sessionId === "string" ? sessionId : undefined;
}

/** Wraps `events` so every `session_ready` status event's `detail.sessionId`
 * updates `ref.current` as it streams past, then yields the event on
 * unchanged — the one place `runBridgeSession` taps the agent's own
 * conversation id, without `forwardEvents` itself (kept generic and untyped
 * for testability) needing to know anything about normalized events. Mirrors
 * `truncateEvents`. */
export async function* captureAgentSessionId(
	events: AsyncIterable<unknown>,
	ref: AgentSessionIdRef
): AsyncGenerator<unknown> {
	for await (const event of events) {
		const id = sessionReadyId(event);
		if (id !== undefined) {
			ref.current = id;
		}
		yield event;
	}
}
