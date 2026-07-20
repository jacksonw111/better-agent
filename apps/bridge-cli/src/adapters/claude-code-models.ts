// Split out of claude-code.ts purely to keep that file under the repo's
// 300-line limit — the SDK's `supportedModels()` fetch/merge is self-
// contained plumbing with no dependency on the rest of the adapter.

import type { query } from "@anthropic-ai/claude-agent-sdk";
import { isRecord, type NormalizedEvent } from "../normalize/types";
import { CLAUDE_CODE_SESSION_CAPABILITIES } from "./session-capabilities";

export type ClaudeQuery = ReturnType<typeof query>;

/** How long to wait for the SDK's `supportedModels()` before emitting
 * `session_ready` without a model list. A safety valve so a stuck control
 * channel can never freeze the feed at its very first event — the startup
 * session_ready (claude-code-startup-ready.ts) awaits this during `start()`.
 * The old 4000 was too tight: the control channel measured ~3.9s on a real
 * plugin-heavy machine (2026-07-19 resume-caps investigation), so half the
 * time the handshake shipped with no models and the composer's model picker
 * silently vanished. */
const SUPPORTED_MODELS_TIMEOUT_MS = 8000;

/** One `supportedModels()` row the adapter keeps: the switchable alias id
 * (`value`, e.g. "sonnet") plus the canonical wire id that alias resolves to
 * (`resolvedModel`, e.g. "claude-sonnet-4-5") — the latter is what the init
 * line reports as the session's current `model`. */
export interface ReportedModel {
	resolvedModel?: string;
	value: string;
}

/** Fetches this session's available models from the SDK control channel,
 * resolving to `undefined` (never rejecting, never hanging) on any failure or
 * timeout — see SUPPORTED_MODELS_TIMEOUT_MS. The web model picker lists exactly
 * these rows' `value` ids; an empty/absent list hides the picker. */
export function fetchSupportedModels(
	session: ClaudeQuery
): Promise<ReportedModel[] | undefined> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), SUPPORTED_MODELS_TIMEOUT_MS);
	});
	const models = session
		.supportedModels()
		.then((infos) =>
			infos.map((info) => ({
				resolvedModel: info.resolvedModel,
				value: info.value,
			}))
		)
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));
	return Promise.race([models, timeout]);
}

/** The init line's `model` is the CANONICAL wire id while the switchable list
 * holds alias rows — without mapping it back to the alias whose
 * `resolvedModel` matches, the composer's model menu could never highlight
 * (or label) the session's current model. Exact matches only: a prefix match
 * against versioned ids risks crossing model families ("claude-sonnet-4" vs
 * "claude-sonnet-4-5"). An unresolvable id stays verbatim — the web appends
 * it to the menu as its own option instead. */
function resolveModelAlias(model: unknown, list: ReportedModel[]): unknown {
	if (
		typeof model !== "string" ||
		list.some((entry) => entry.value === model)
	) {
		return model;
	}
	const match = list.find((entry) => entry.resolvedModel === model);
	return match ? match.value : model;
}

/** Folds the agent's reported model ids into the one-time `session_ready`
 * event (and resolves the current model to its alias — see
 * `resolveModelAlias`), leaving every other event untouched. The list comes
 * from the SDK (`supportedModels()`), not the raw init line
 * `normalize/claude-code.ts` sees, so it's merged here in the adapter rather
 * than in normalize. */
export async function withReportedModels(
	event: NormalizedEvent,
	models: Promise<ReportedModel[] | undefined>
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
		detail: {
			...event.detail,
			model: resolveModelAlias(event.detail.model, list),
			models: list.map((entry) => entry.value),
		},
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
