// pi's `get_available_models` command builder + response parsers, split out
// of pi-commands.ts purely to keep that file under the repo's 300-line
// limit — re-exported from pi-commands.ts so existing imports keep working
// (mirrors normalize/pi.ts re-exporting pi-extension-ui.ts's
// `normalizePiExtensionUiRequest`).

import { asString, isRecord } from "./types";

/** Builds the `get_available_models` stdin command — fired once at start so the
 * model menu can list every model pi can switch to (not just the current one
 * `get_state` reports). ASSUMPTION (unverified, same source as
 * `normalizePiCommandsResponse` in pi-commands.ts): returns `{ data: { models:
 * Model[] } }` where each Model is the same shape `get_state`'s `data.model`
 * uses. */
export function buildPiGetAvailableModelsCommand(): string {
	return JSON.stringify({ type: "get_available_models" });
}

/** A pi `Model` object's display id — `id` preferred over the human-readable
 * `name`. Extracted so `normalizePiAvailableModels` stays under the complexity
 * gate (the `isRecord`/`??` branches live here instead). */
function piModelId(model: unknown): string | undefined {
	return isRecord(model)
		? (asString(model.id) ?? asString(model.name))
		: undefined;
}

function isDefinedString(value: unknown): value is string {
	return typeof value === "string";
}

/** Parses a `get_available_models` RPC response's `data.models` into the
 * switchable model-id list the web model menu shows, or `undefined` if `raw`
 * isn't a successful `get_available_models` response.
 *
 * ASSUMPTION (unverified — same source as `normalizePiStateModel` in
 * pi-commands.ts): `data.models` is `Model[]` where each Model is the same
 * `{id, name, ...}` shape `get_state`'s `data.model` uses; `id` is preferred
 * over `name`. */
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
