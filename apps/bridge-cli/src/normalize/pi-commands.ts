// pi command builders + response parsers, split out of normalize/pi.ts so
// neither file exceeds the repo's 300-line limit. This half owns the stdin
// command frames the adapter sends (`prompt`, `get_state`, `get_commands`,
// `get_available_models`, `set_model`) and the curated shapes parsed out of
// their `response` replies; normalize/pi.ts owns stdout event normalization.

import { asString, isRecord } from "./types";

/** Builds one `pi --mode rpc` stdin command for a user turn. */
export function buildPiPromptCommand(text: string): string {
	return JSON.stringify({ type: "prompt", message: text });
}

// --- session_ready: get_commands / get_state -------------------------------
//
// pi has no single "init" line the way claude-code does (see
// normalize/claude-code.ts's `normalizeClaudeSystem`) — its capabilities are
// only obtainable by *asking*, via two RPC commands the adapter sends once at
// start (see pi.ts): `get_commands` (slash commands + skills) and `get_state`
// (the current model). This module stays stateless, so it only parses each
// command's `response` line into its curated shape; pi.ts owns merging the
// pieces into one `session_ready` event and guarding against emitting it more
// than once.

/** Builds the `get_commands`/`get_state` stdin command frames pi.ts sends
 * once, right after the process starts. */
export function buildPiGetCommandsCommand(): string {
	return JSON.stringify({ type: "get_commands" });
}

export function buildPiGetStateCommand(): string {
	return JSON.stringify({ type: "get_state" });
}

/** Builds the `get_available_models` stdin command — fired once at start so the
 * model menu can list every model pi can switch to (not just the current one
 * `get_state` reports). ASSUMPTION (unverified, same source as
 * `normalizePiCommandsResponse`): returns `{ data: { models: Model[] } }` where
 * each Model is the same shape `get_state`'s `data.model` uses. */
export function buildPiGetAvailableModelsCommand(): string {
	return JSON.stringify({ type: "get_available_models" });
}

/** Builds the `set_model` stdin command — switches the model used for
 * subsequent turns (the model menu's pick). pi's `set_model` takes SEPARATE
 * `provider` + `modelId` fields (NOT a single `model` string — that form was a
 * no-op), so callers must resolve the provider for the chosen model id (see the
 * pi adapter's model→provider map). Ref: pi rpc.md `set_model`. */
export function buildPiSetModelCommand(
	provider: string,
	modelId: string
): string {
	return JSON.stringify({ type: "set_model", provider, modelId });
}

// --- extension_ui_request / extension_ui_response (RC-T4) ------------------
//
// VERIFIED (fetched packages/coding-agent/docs/rpc.md from badlogic/pi-mono
// @ main): every request is `{ type: "extension_ui_request", id, method:
// "select"|"confirm"|"input"|"editor", title, ... }`, matched by `id`.
// Responses: `select` replies `{ type: "extension_ui_response", id, value }`
// (value is one of the request's `options` strings); `confirm` replies
// `{ ..., confirmed: boolean }`; any dialog method can instead reply
// `{ ..., cancelled: true }`, which is what these two builders send — the
// cancel form both `presentApproval`'s shared timeout AND the adapter's
// immediate auto-cancel for unrepresentable `input`/`editor` requests use, so
// an extension asking the user something can NEVER hang the turn (see
// normalize/pi.ts's `normalizePiExtensionUiRequest` and
// adapters/pi-approvals.ts).

const PI_CONFIRM_METHOD = "confirm";

/** Builds the stdin reply for a `select`/`confirm` extension_ui_request whose
 * `optionId` (an `ApprovalEvent` option id from `normalizePiExtensionUiRequest`)
 * was actually answered by the user — never called for the cancel/timeout
 * path, see `buildPiExtensionUiCancelResponse`. */
export function buildPiExtensionUiResponse(
	method: string,
	id: string,
	optionId: string
): string {
	return method === PI_CONFIRM_METHOD
		? JSON.stringify({
				type: "extension_ui_response",
				id,
				confirmed: optionId === "confirmed",
			})
		: JSON.stringify({ type: "extension_ui_response", id, value: optionId });
}

/** Builds the stdin reply for the fail-closed path: a `select`/`confirm`
 * whose shared timeout fired unanswered, or an `input`/`editor` request
 * (free-form text has no deny analog, so it's auto-cancelled immediately
 * instead of ever becoming a card). */
export function buildPiExtensionUiCancelResponse(id: string): string {
	return JSON.stringify({ type: "extension_ui_response", id, cancelled: true });
}

/** A command entry as returned by `get_commands` — see
 * `normalizePiCommandsResponse`'s ASSUMPTION note below for the source. */
interface PiCommandInfo {
	name: string;
	source?: string;
}

function isPiCommandInfo(value: unknown): value is PiCommandInfo {
	return isRecord(value) && typeof value.name === "string";
}

/** Skill commands' `name` is prefixed this way in `get_commands`' response —
 * stripped for the curated `skills` list, kept as-is in `slashCommands` so
 * both remain directly invocable via `/<name>`. */
const PI_SKILL_PREFIX = "skill:";

function splitPiCommands(commands: PiCommandInfo[]): {
	skills: string[];
	slashCommands: string[];
} {
	const slashCommands: string[] = [];
	const skills: string[] = [];
	for (const command of commands) {
		slashCommands.push(command.name);
		if (
			command.source === "skill" &&
			command.name.startsWith(PI_SKILL_PREFIX)
		) {
			skills.push(command.name.slice(PI_SKILL_PREFIX.length));
		}
	}
	return { skills, slashCommands };
}

/**
 * Parses a `get_commands` RPC response's `data.commands` into
 * `session_ready`'s `slashCommands`/`skills` shape, or `null` if `raw` isn't
 * a successful `get_commands` response (a different command's response, a
 * failed one — see `normalizePiResponse` — or any other stdout line).
 *
 * ASSUMPTION (unverified — no `pi` binary available in this sandbox; shape
 * per https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md):
 * `data.commands` is `{name, description, source: "extension"|"prompt"|"skill", location?, path?}[]`;
 * skills are the entries with `source: "skill"`, whose `name` is prefixed
 * `skill:`. Reverify against the installed pi version before relying on this.
 */
export function normalizePiCommandsResponse(
	raw: unknown
): { skills: string[]; slashCommands: string[] } | null {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== "get_commands" ||
		raw.success !== true
	) {
		return null;
	}
	const data = raw.data;
	if (!(isRecord(data) && Array.isArray(data.commands))) {
		return null;
	}
	return splitPiCommands(data.commands.filter(isPiCommandInfo));
}

/**
 * Parses a `get_state` RPC response's `data.model` into a display model
 * name, or `undefined` if `raw` isn't a successful `get_state` response with
 * a model set yet.
 *
 * ASSUMPTION (unverified — same source as `normalizePiCommandsResponse`):
 * `data.model` is a full Model object (`{id, name, provider, ...}`) or
 * `null` if no model has been selected yet. `id` (e.g.
 * `"claude-sonnet-4-20250514"`) is preferred over the human-readable `name`
 * to match the other adapters' `model` field.
 */
export function normalizePiStateModel(raw: unknown): string | undefined {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== "get_state" ||
		raw.success !== true
	) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const data = raw.data;
	if (!(isRecord(data) && isRecord(data.model))) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return asString(data.model.id) ?? asString(data.model.name);
}

/** Parses a `get_available_models` RPC response's `data.models` into the
 * switchable model-id list the web model menu shows, or `undefined` if `raw`
 * isn't a successful `get_available_models` response.
 *
 * ASSUMPTION (unverified — same source as `normalizePiStateModel`):
 * `data.models` is `Model[]` where each Model is the same `{id, name, ...}`
 * shape `get_state`'s `data.model` uses; `id` is preferred over `name`. */
export function normalizePiAvailableModels(raw: unknown): string[] | undefined {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== "get_available_models" ||
		raw.success !== true
	) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const data = raw.data;
	if (!(isRecord(data) && Array.isArray(data.models))) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return data.models.map(piModelId).filter(isDefinedString);
}

/** A pi `Model` object's display id — `id` preferred over the human-readable
 * `name`. Extracted so `normalizePiAvailableModels` stays under the complexity
 * gate (the `isRecord`/`??` branches live here instead). */
function piModelId(model: unknown): string | undefined {
	return isRecord(model)
		? (asString(model.id) ?? asString(model.name))
		: undefined;
}

/** A single `{id, provider}` pair from a pi Model, or null when either is
 * missing — keeps `normalizePiModelProviders` under the complexity gate. */
function piModelProviderEntry(model: unknown): [string, string] | null {
	if (!isRecord(model)) {
		return null;
	}
	const id = asString(model.id);
	const provider = asString(model.provider);
	return id && provider ? [id, provider] : null;
}

/** Parses `get_available_models` into a model-id → provider map so the adapter
 * can build `set_model`'s required `{provider, modelId}` from the bare id the
 * web menu sends. `undefined` if `raw` isn't a successful
 * `get_available_models` response; entries missing an id or provider are
 * skipped. */
export function normalizePiModelProviders(
	raw: unknown
): Record<string, string> | undefined {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== "get_available_models" ||
		raw.success !== true
	) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const data = raw.data;
	if (!(isRecord(data) && Array.isArray(data.models))) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return Object.fromEntries(
		data.models.map(piModelProviderEntry).filter((entry) => entry !== null)
	);
}

function isDefinedString(value: unknown): value is string {
	return typeof value === "string";
}
