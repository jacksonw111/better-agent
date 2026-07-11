// R2-T2: codex's model picker source — split out of codex.ts purely to keep
// that file under the repo's 300-line limit. codex's app-server is asked for
// its live model list on every session start; any failure (RPC error,
// malformed result, or a slow reply past the timeout) falls back to a static
// list instead of leaving the composer's model picker empty/disabled.

import { asString, isRecord } from "../normalize/types";

/** ASSUMPTION (unverified — no `codex` binary in this sandbox): the static
 * fallback ids codex's model picker offers when `model/list` is unavailable
 * — mirrors hermes's own static fallback table (gpt-5.5/5.4/5.4-mini/
 * 5.3-codex/5.3-codex-spark), which verified this list against a real codex
 * 0.130.0 binary. Kept in sync with the web's `CODEX_CAPABILITIES` static
 * matrix note in `apps/web/src/components/bridge/agent-capabilities.ts`. */
export const CODEX_STATIC_MODELS: readonly string[] = [
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
];

/** How long `model/list` may take before `fetchCodexModelList` gives up and
 * falls back to `CODEX_STATIC_MODELS` — see this module's doc comment. Kept
 * short (unlike claude-code's 4s `CONTROL_CALL_TIMEOUT_MS`) since this gates
 * `session_ready`, the very first line of a codex session's feed. */
export const CODEX_MODEL_LIST_TIMEOUT_MS = 2000;

/** codex's `model/list` RPC. ASSUMPTION (unverified — no `codex` binary in
 * this sandbox): the request name itself, and that its result carries a
 * `models` array of objects each identified by one of `id`/`model`/`name`
 * (tried in that order — whichever the running codex version actually
 * uses). Any entry missing all three is dropped rather than crashing the
 * whole parse. */
function extractCodexModelIds(result: unknown): string[] {
	if (!(isRecord(result) && Array.isArray(result.models))) {
		return [];
	}
	const ids: string[] = [];
	for (const entry of result.models) {
		if (!isRecord(entry)) {
			continue;
		}
		const id =
			asString(entry.id) ?? asString(entry.model) ?? asString(entry.name);
		if (id !== undefined) {
			ids.push(id);
		}
	}
	return ids;
}

/** Minimal shape `fetchCodexModelList` needs off `JsonRpcIo` — kept
 * structural so tests can hand in a plain mock. */
export interface ModelListRpc {
	request(method: string, params: unknown): Promise<unknown>;
}

/**
 * Fetches codex's live model list, resolving to `CODEX_STATIC_MODELS`
 * (never rejecting, never hanging) on any RPC failure, an empty/malformed
 * result, or a reply that doesn't land within `CODEX_MODEL_LIST_TIMEOUT_MS`
 * — see this module's doc comment. Called once per session, right after
 * `thread/start` resolves.
 */
export function fetchCodexModelList(rpc: ModelListRpc): Promise<string[]> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<string[]>((resolve) => {
		timer = setTimeout(() => {
			resolve([...CODEX_STATIC_MODELS]);
		}, CODEX_MODEL_LIST_TIMEOUT_MS);
	});
	const result = rpc
		.request("model/list", {})
		.then((res) => {
			const ids = extractCodexModelIds(res);
			return ids.length > 0 ? ids : [...CODEX_STATIC_MODELS];
		})
		.catch(() => [...CODEX_STATIC_MODELS])
		.finally(() => clearTimeout(timer));
	return Promise.race([result, timeout]);
}
