// opencode: `opencode serve` — the HTTP + SSE server built into the opencode
// CLI (the superset ACP wraps; see docs/remote-control-plan.md §2 item 4).
// This maps the `GET /event` SSE stream's `data:` payloads onto the
// normalized event model. Requests (`POST /session`, `POST
// /session/:id/message`, …) are issued by the adapter, not mapped here.
//
// ASSUMPTION (unverified — no `opencode` binary in this sandbox; shapes per
// opencode's server SDK source as researched for the plan): each SSE `data:`
// frame is `{ type: string, properties: {...} }`, with the types handled
// below. Every parse is `isRecord`-guarded so an unexpected shape degrades to
// "no events", never a crash. Reverify against a real `opencode serve` before
// relying on any exact field name.

import { normalizeServeQuestion } from "./opencode-serve-question";
import {
	type ApprovalEvent,
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
	type ToolEvent,
} from "./types";

/** ASSUMPTION (unverified): the events that carry a session id do so as
 * `properties.sessionID`, or nested on `properties.part` / `properties.info`
 * for message-scoped events. Absent ids are treated as "ours" so a shape
 * drift degrades to over-reporting rather than a silent dead feed. */
function serveEventSessionId(
	properties: Record<string, unknown>
): string | undefined {
	const direct = asString(properties.sessionID);
	if (direct !== undefined) {
		return direct;
	}
	const part = isRecord(properties.part) ? properties.part : undefined;
	const fromPart = part === undefined ? undefined : asString(part.sessionID);
	if (fromPart !== undefined) {
		return fromPart;
	}
	const info = isRecord(properties.info) ? properties.info : undefined;
	return info === undefined ? undefined : asString(info.sessionID);
}

// --- message parts -----------------------------------------------------------

/** ASSUMPTION (unverified): `message.part.updated` re-sends the WHOLE part on
 * every update, so a text part's `text` is an accumulated snapshot, not a
 * delta. `partTexts` tracks what's already been emitted per part id and only
 * the new suffix goes out (as `output`, so the UI accumulates chunks into one
 * bubble — same reasoning as the ACP normalizer). A non-prefix rewrite falls
 * back to emitting the full new text.
 *
 * RESIDUAL RISK (id contract): unlike codex, this normalizer never emits a
 * final `message` event for the same content, so it can't hit the
 * delta+final double-BUBBLE bug this file's `id` field fixes elsewhere (see
 * normalize/codex.ts, bridge-turns.ts). But it also never stamps `id` on the
 * `output` events it emits, so if the SAME logical message's part id ever
 * changed mid-stream, `partTexts` would restart from "" for the new id and
 * re-emit the already-shown text as a fresh delta — a doubled-TEXT-within-
 * one-bubble failure, not a doubled bubble. No `opencode serve` binary is
 * available to verify whether a part id is stable for a message's lifetime;
 * left undocumented-but-unfixed rather than guessed at. */
function normalizeServeTextPart(
	part: Record<string, unknown>,
	partTexts: Map<string, string>
): NormalizedEvent[] {
	const text = asString(part.text);
	const id = asString(part.id);
	if (text === undefined || text.length === 0) {
		return NO_EVENTS;
	}
	const previous = (id === undefined ? undefined : partTexts.get(id)) ?? "";
	const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
	if (id !== undefined) {
		partTexts.set(id, text);
	}
	if (delta.length === 0) {
		return NO_EVENTS;
	}
	return [
		{ kind: "output", text: delta, reasoning: part.type === "reasoning" },
	];
}

/** R1-T2: `state.time: {start, end}` (ms-epoch) is only complete once the
 * tool finishes — `durationMs` is undefined while still running. */
function serveToolDurationMs(
	state: Record<string, unknown>
): number | undefined {
	const time = isRecord(state.time) ? state.time : undefined;
	const start = typeof time?.start === "number" ? time.start : undefined;
	const end = typeof time?.end === "number" ? time.end : undefined;
	return start === undefined || end === undefined ? undefined : end - start;
}

/** ASSUMPTION (unverified): a tool part is `{ type: "tool", callID, tool,
 * state: { status: "pending"|"running"|"completed"|"error", input?, output?,
 * error?, title?, time?: {start, end} } }`. Unknown statuses degrade to
 * "started" so a tool at least shows up as running. */
function normalizeServeToolPart(
	part: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(part.callID) ?? asString(part.id);
	if (id === undefined) {
		return NO_EVENTS;
	}
	const state = isRecord(part.state) ? part.state : {};
	let status: ToolEvent["status"] = "started";
	if (state.status === "completed") {
		status = "completed";
	} else if (state.status === "error") {
		status = "failed";
	}
	return [
		{
			kind: "tool",
			id,
			name: asString(part.tool) ?? id,
			status,
			input: state.input,
			output: state.output ?? asString(state.error),
			title: asString(state.title),
			durationMs: serveToolDurationMs(state),
		},
	];
}

function sumTokenCounts(values: unknown[]): number | undefined {
	const numbers = values.filter((value) => typeof value === "number");
	return numbers.length === 0
		? undefined
		: numbers.reduce((total, value) => total + value, 0);
}

/** ASSUMPTION (unverified): a step-finish part carries `{ cost: number,
 * tokens: { input, output, reasoning, cache: { read, write } } }`. Mapped to
 * the same `usage_update` status the web already renders for opencode's ACP
 * stream (`UsageUpdateDetail` in
 * `apps/web/src/components/bridge/bridge-session-status.ts`: `{ used, size?,
 * cost: { amount } }`); serve doesn't report the context-window size here, so
 * `size` is left unset. */
function normalizeServeStepFinish(
	part: Record<string, unknown>
): NormalizedEvent[] {
	const tokens = isRecord(part.tokens) ? part.tokens : {};
	const cache = isRecord(tokens.cache) ? tokens.cache : {};
	const used = sumTokenCounts([
		tokens.input,
		tokens.output,
		tokens.reasoning,
		cache.read,
		cache.write,
	]);
	const cost =
		typeof part.cost === "number" ? { amount: part.cost } : undefined;
	if (used === undefined && cost === undefined) {
		return NO_EVENTS;
	}
	return [{ kind: "status", status: "usage_update", detail: { used, cost } }];
}

function normalizeServePart(
	part: unknown,
	partTexts: Map<string, string>
): NormalizedEvent[] {
	if (!isRecord(part) || typeof part.type !== "string") {
		return NO_EVENTS;
	}
	switch (part.type) {
		case "text":
		case "reasoning":
			return normalizeServeTextPart(part, partTexts);
		case "tool":
			return normalizeServeToolPart(part);
		case "step-finish":
			return normalizeServeStepFinish(part);
		default:
			// step-start / file / snapshot parts carry nothing worth rendering.
			return NO_EVENTS;
	}
}

// --- permissions -------------------------------------------------------------

/** ASSUMPTION (unverified): a `permission.updated` event is `{ id, sessionID,
 * title, metadata?, … }`. Option ids are the literal reply values BOTH the
 * new and deprecated permission-reply routes take (opencode-serve-approvals.ts). */
const SERVE_PERMISSION_OPTIONS: ApprovalEvent["options"] = [
	{ id: "once", label: "Allow once" },
	{ id: "always", label: "Always allow" },
	{ id: "reject", label: "Deny" },
];

function normalizeServePermission(
	properties: Record<string, unknown>
): NormalizedEvent[] {
	const requestId = asString(properties.id);
	if (requestId === undefined) {
		return NO_EVENTS;
	}
	return [
		{
			detail:
				properties.metadata === undefined
					? undefined
					: JSON.stringify(properties.metadata),
			kind: "approval",
			options: SERVE_PERMISSION_OPTIONS.map((option) => ({ ...option })),
			requestId,
			title: asString(properties.title) ?? "Approve action?",
		},
	];
}

// --- event envelope ----------------------------------------------------------

function normalizeServeEvent(
	type: string,
	properties: Record<string, unknown>,
	partTexts: Map<string, string>
): NormalizedEvent[] {
	switch (type) {
		case "message.part.updated":
			return normalizeServePart(properties.part, partTexts);
		case "permission.updated":
			return normalizeServePermission(properties);
		case "question.asked":
			return normalizeServeQuestion(properties);
		case "session.error":
			return [
				{
					kind: "error",
					message: "opencode session error",
					detail: properties.error ?? properties,
				},
			];
		case "session.idle":
			// The turn is over — same status name pi uses, rendered as a plain
			// status line.
			return [{ kind: "status", status: "turn_end" }];
		default:
			// Unlike the ACP normalizer's pass-through default, unknown types are
			// DROPPED: the serve /event stream is server-global and chatty
			// (storage writes, file watcher, lsp, message.updated envelopes…) and
			// passing it all through would flood the web feed with status lines.
			return NO_EVENTS;
	}
}

/**
 * Builds the (stateful — it tracks per-part emitted text to turn snapshot
 * updates into deltas) mapper for one session's view of the server-global
 * `GET /event` stream. Events that name a DIFFERENT session are dropped.
 */
export function createOpencodeServeNormalizer(
	sessionId: string
): (raw: unknown) => NormalizedEvent[] {
	const partTexts = new Map<string, string>();
	return (raw: unknown): NormalizedEvent[] => {
		if (!isRecord(raw) || typeof raw.type !== "string") {
			return NO_EVENTS;
		}
		const properties = isRecord(raw.properties) ? raw.properties : {};
		const eventSession = serveEventSessionId(properties);
		if (eventSession !== undefined && eventSession !== sessionId) {
			return NO_EVENTS;
		}
		return normalizeServeEvent(raw.type, properties, partTexts);
	};
}

// --- model list --------------------------------------------------------------

/**
 * Extracts `"providerID/modelID"` strings from a `GET /config/providers`
 * response body, for `session_ready`'s `models` list (the web's model menu).
 *
 * ASSUMPTION (unverified): the body is `{ providers: [{ id, models: { <modelID>:
 * {...} } }], … }`. Anything off-shape contributes nothing.
 */
export function parseOpencodeServeModels(raw: unknown): string[] {
	if (!(isRecord(raw) && Array.isArray(raw.providers))) {
		return [];
	}
	const models: string[] = [];
	for (const provider of raw.providers) {
		if (
			!isRecord(provider) ||
			typeof provider.id !== "string" ||
			!isRecord(provider.models)
		) {
			continue;
		}
		for (const modelId of Object.keys(provider.models)) {
			models.push(`${provider.id}/${modelId}`);
		}
	}
	return models;
}
