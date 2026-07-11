// opencode serve: parses `GET /global/health` and `GET /agent` — the R2-T3
// items 6/7 health probe + agent-list. Kept beside normalize/opencode-serve.ts
// (mirrors opencode-serve-status.ts) so neither file exceeds the repo's
// 300-line cap; consumed by adapters/opencode-serve.ts's `fetchServeHealth`/
// `fetchServeAgents`.
//
// ASSUMPTION (unverified — no `opencode` binary in this sandbox; shapes per
// the brief's researched opencode server SDK source): `GET /global/health`
// responds `{ healthy: boolean, version?: string }` (a 404 on an older server
// build means "legacy" — handled by the adapter's fetch wrapper, not here);
// `GET /agent` responds an array of `{ name, mode?: "primary"|"subagent"|
// "all", hidden?: boolean, ... }` — opencode's own "primary"/"all" modes are
// the two a user can pick as a session's active agent (a "subagent" entry is
// only ever invoked BY another agent, never chosen directly), and a `hidden:
// true` entry is deliberately excluded from any picker.

import { asString, isRecord } from "./types";

export interface OpencodeServeHealth {
	healthy?: boolean;
	version?: string;
}

/** `undefined` (not `{}`) for anything that isn't even a record, so
 * `fetchServeHealth` can tell "the server responded something odd" apart from
 * "there's nothing to report" — both degrade the same way today, but keeping
 * the distinction costs nothing. */
export function parseOpencodeServeHealth(
	raw: unknown
): OpencodeServeHealth | undefined {
	if (!isRecord(raw)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		healthy: typeof raw.healthy === "boolean" ? raw.healthy : undefined,
		version: asString(raw.version),
	};
}

/** The two agent modes a session can actively run as — see this file's header
 * ASSUMPTION note for why "subagent" is excluded. */
const SELECTABLE_AGENT_MODES = new Set(["primary", "all"]);

function isSelectableServeAgent(entry: unknown): entry is { name: string } {
	return (
		isRecord(entry) &&
		typeof entry.name === "string" &&
		entry.hidden !== true &&
		(entry.mode === undefined || SELECTABLE_AGENT_MODES.has(String(entry.mode)))
	);
}

/** Extracts the selectable agent names from a `GET /agent` response, for
 * `session_ready`'s `permissionModes` — opencode serve's counterpart to the
 * ACP transport's static `["build", "plan"]` (see opencode.ts). Anything
 * off-shape (not an array, entries missing `name`) yields `[]`, NOT a thrown
 * error — the adapter's `fetchServeAgents` falls back to the static list on
 * either an empty result or a request failure. */
export function parseOpencodeServeAgents(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter(isSelectableServeAgent).map((entry) => entry.name);
}
