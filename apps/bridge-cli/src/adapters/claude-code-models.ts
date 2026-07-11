// Split out of claude-code.ts purely to keep that file under the repo's
// 300-line limit — the SDK's `supportedModels()` fetch/merge is self-
// contained plumbing with no dependency on the rest of the adapter.

import type { query } from "@anthropic-ai/claude-agent-sdk";
import { isRecord, type NormalizedEvent } from "../normalize/types";
import { CLAUDE_CODE_SESSION_CAPABILITIES } from "./session-capabilities";

export type ClaudeQuery = ReturnType<typeof query>;

/** How long to wait for the SDK's `supportedModels()` — resolved off the same
 * init handshake that yields the `session_ready` line — before emitting
 * `session_ready` without a model list. A safety valve so a stuck control
 * channel can never freeze the feed at its very first event; in practice the
 * list is already resolved by the time the init line is normalized. */
const SUPPORTED_MODELS_TIMEOUT_MS = 4000;

/** Fetches this session's available model ids from the SDK control channel,
 * resolving to `undefined` (never rejecting, never hanging) on any failure or
 * timeout — see SUPPORTED_MODELS_TIMEOUT_MS. The web model picker lists exactly
 * these ids; an empty/absent list hides the picker. */
export function fetchSupportedModels(
	session: ClaudeQuery
): Promise<string[] | undefined> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), SUPPORTED_MODELS_TIMEOUT_MS);
	});
	const models = session
		.supportedModels()
		.then((infos) => infos.map((info) => info.value))
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));
	return Promise.race([models, timeout]);
}

/** Folds the agent's reported model ids into the one-time `session_ready`
 * event, leaving every other event untouched. The list comes from the SDK
 * (`supportedModels()`), not the raw init line `normalize/claude-code.ts` sees,
 * so it's merged here in the adapter rather than in normalize. */
export async function withReportedModels(
	event: NormalizedEvent,
	models: Promise<string[] | undefined>
): Promise<NormalizedEvent> {
	if (event.kind !== "status" || event.status !== "session_ready") {
		return event;
	}
	const list = await models;
	if (list === undefined || list.length === 0 || !isRecord(event.detail)) {
		return event;
	}
	return {
		kind: "status",
		status: "session_ready",
		detail: { ...event.detail, models: list },
	};
}

/** R2-T1: attaches claude-code's static `SessionCapabilities` constant to the
 * one-time `session_ready` event, leaving every other event untouched — the
 * web's `resolveCapabilities` (agent-capabilities.ts) reads it straight off
 * the wire, falling back to its own static matrix only when it's absent. */
export function withSessionCapabilities(
	event: NormalizedEvent
): NormalizedEvent {
	if (
		event.kind !== "status" ||
		event.status !== "session_ready" ||
		!isRecord(event.detail)
	) {
		return event;
	}
	return {
		kind: "status",
		status: "session_ready",
		detail: {
			...event.detail,
			capabilities: CLAUDE_CODE_SESSION_CAPABILITIES,
		},
	};
}
