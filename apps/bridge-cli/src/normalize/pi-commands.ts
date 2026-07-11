// pi command builders + response parsers, split out of normalize/pi.ts so
// neither file exceeds the repo's 300-line limit. This half owns the stdin
// command frames the adapter sends (`prompt`, `get_state`, `get_commands`,
// `get_available_models`, `set_model`) and the curated shapes parsed out of
// their `response` replies; normalize/pi.ts owns stdout event normalization.

import { asString, isRecord } from "./types";

/** The values pi's `prompt` command accepts for `streamingBehavior` — see
 * `buildPiPromptCommand`'s doc comment (R2-T3 item 1, CRITICAL). ASSUMPTION
 * (unverified, no `pi` binary in this sandbox — per the brief's researched
 * rpc-types v0.80.6 shape): `"steer"` interrupts the current turn with this
 * message, `"followUp"` queues it behind the current turn. */
export type PiStreamingBehavior = "followUp" | "steer";

/**
 * Builds one `pi --mode rpc` stdin command for a user turn.
 *
 * CRITICAL (R2-T3 item 1): pi ERRORS on a bare `prompt` sent while it's still
 * streaming a turn — the adapter's streaming tracker (adapters/pi-streaming.ts)
 * must pass `"followUp"` (the safe, non-interrupting default) whenever a
 * `send()` lands mid-turn; `streamingBehavior` is omitted entirely (unchanged
 * from before this fix) for an idle send, and `"steer"` is supported for a
 * future mid-turn-redirect UI but never sent by this adapter today.
 */
export function buildPiPromptCommand(
	text: string,
	streamingBehavior?: PiStreamingBehavior
): string {
	return streamingBehavior === undefined
		? JSON.stringify({ type: "prompt", message: text })
		: JSON.stringify({ type: "prompt", message: text, streamingBehavior });
}

/** The thinking-effort levels pi's `set_thinking_level` command accepts
 * (R2-T3 item 2). ASSUMPTION (unverified, no `pi` binary in this sandbox —
 * per the brief's researched rpc-types v0.80.6 shape): this exact 7-value
 * vocabulary. */
export const PI_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

/** Validates a `setThinking` level against pi's fixed vocabulary before
 * `AgentHandle.setThinking` (adapters/pi.ts) builds a wire frame from it — an
 * unrecognized level degrades to a visible error event instead of a frame pi
 * itself would reject. */
export function isPiThinkingLevel(value: string): value is PiThinkingLevel {
	return (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

/** Builds the `set_thinking_level` stdin command (R2-T3 item 2). */
export function buildPiSetThinkingLevelCommand(level: PiThinkingLevel): string {
	return JSON.stringify({ type: "set_thinking_level", level });
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

// `get_available_models`' command builder + response parsers live in
// pi-models.ts, split out purely to keep this file under the repo's 300-line
// limit; re-exported here so existing imports of these from "./pi-commands"
// keep working (mirrors normalize/pi.ts's re-export of
// `normalizePiExtensionUiRequest` from pi-extension-ui.ts).
export {
	buildPiGetAvailableModelsCommand,
	normalizePiAvailableModels,
	normalizePiModelProviders,
} from "./pi-models";

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
 * `optionId` (a `select`'s chosen option string, or one of `confirm`'s
 * 确认/取消 `ApprovalEvent` option ids — see `normalizePiExtensionUiRequest`)
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
				confirmed: optionId === "confirm",
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
 * `normalizePiCommandsResponse`'s ASSUMPTION note below for the source.
 * `source`/`sourceInfo` are both `unknown`, not typed to either shape, since
 * which one a given pi version sends is exactly what `piCommandSource`
 * (R2-T3 item 4) is resolving. */
interface PiCommandInfo {
	name: string;
	source?: unknown;
	sourceInfo?: unknown;
}

function isPiCommandInfo(value: unknown): value is PiCommandInfo {
	return isRecord(value) && typeof value.name === "string";
}

/** Skill commands' `name` is prefixed this way in `get_commands`' response —
 * stripped for the curated `skills` list, kept as-is in `slashCommands` so
 * both remain directly invocable via `/<name>`. */
const PI_SKILL_PREFIX = "skill:";

/** A command's provenance string ("extension"/"prompt"/"skill"), read from
 * WHICHEVER shape `raw` carries it in (R2-T3 item 4): the older flat
 * `source` string, or v0.80.6's `sourceInfo: { scope, ... }` — so a pi
 * upgrade/downgrade never silently drops the whole skills list. ASSUMPTION
 * (unverified, no `pi` binary in this sandbox): `sourceInfo.scope` mirrors
 * the old `source` string 1:1. */
function piCommandSource(command: PiCommandInfo): string | undefined {
	return (
		asString(command.source) ??
		(isRecord(command.sourceInfo)
			? asString(command.sourceInfo.scope)
			: undefined)
	);
}

function splitPiCommands(commands: PiCommandInfo[]): {
	skills: string[];
	slashCommands: string[];
} {
	const slashCommands: string[] = [];
	const skills: string[] = [];
	for (const command of commands) {
		slashCommands.push(command.name);
		if (
			piCommandSource(command) === "skill" &&
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
 * `data.commands` is `{name, description, source: "extension"|"prompt"|"skill", location?, path?}[]`
 * on older docs, or (R2-T3 item 4, pi rpc-types v0.80.6)
 * `{name, description, sourceInfo: {scope: "extension"|"prompt"|"skill", ...}}[]`;
 * skills are the entries whose resolved source (`piCommandSource`) is
 * `"skill"`, whose `name` is prefixed `skill:`. Reverify against the
 * installed pi version before relying on this.
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
