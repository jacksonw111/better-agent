// Serve's session-scoped "which agent runs this turn" control (R2-T3 items
// 6-8) — GET /agent (session_ready's permissionModes + setPermissionMode's
// fallback) and GET /global/health (the startup diagnostic log line). Split
// out of opencode-serve.ts purely to keep that file under the repo's 300-line
// convention; mirrors opencode-serve-http.ts's role for the lower-level
// transport plumbing.

import {
	type OpencodeServeHealth,
	parseOpencodeServeAgents,
	parseOpencodeServeHealth,
} from "../normalize/opencode-serve-agent";
import {
	type OpencodeServeCommand,
	parseOpencodeServeCommands,
} from "../normalize/opencode-serve-commands";
import type { ServeHttp } from "./opencode-serve-http";

/** opencode serve's own built-in agent names — used when `GET /agent` fails,
 * or (a bare `[]`, or a very old server) returns nothing selectable. Matches
 * the ACP transport's static `permissionModes` (opencode.ts's
 * `opencodeModeControls`), which these two build/plan names are drawn from. */
export const SERVE_AGENT_FALLBACK = ["build", "plan"];

/** GETs the selectable agent names for `session_ready`'s `permissionModes` —
 * falls back to `SERVE_AGENT_FALLBACK` on ANY failure (network error, a 404
 * on an older server, or a response with nothing selectable in it), never
 * throws. */
export async function fetchServeAgents(http: ServeHttp): Promise<string[]> {
	try {
		const agents = parseOpencodeServeAgents(await http.getJson("/agent"));
		return agents.length > 0 ? agents : SERVE_AGENT_FALLBACK;
	} catch {
		return SERVE_AGENT_FALLBACK;
	}
}

/** GETs the startup health probe — `undefined` on ANY failure (including a
 * 404, which `ServeHttp.getJson` surfaces as a thrown error per
 * opencode-serve-http.ts's `fetchJson`): an older server without this route
 * is simply "legacy", not an error worth surfacing to the user. */
export async function fetchServeHealth(
	http: ServeHttp
): Promise<OpencodeServeHealth | undefined> {
	try {
		return parseOpencodeServeHealth(await http.getJson("/global/health"));
	} catch {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
}

/** Logs the probed server version (or a "legacy" note) to stderr once at
 * startup — a plain diagnostic line, not a `NormalizedEvent`; nothing
 * downstream (the web UI, the relay) consumes it, unlike
 * `codex-debug.ts`'s `logRawCodexNotification` this is unconditional (no
 * `BRIDGE_DEBUG_*` gate) since it's a one-line-per-session startup fact, not
 * a verbose per-notification trace. */
export function logServeHealth(health: OpencodeServeHealth | undefined): void {
	if (health?.version !== undefined) {
		process.stderr.write(`[opencode-serve] server version ${health.version}\n`);
		return;
	}
	process.stderr.write(
		"[opencode-serve] health probe returned no version (legacy server?)\n"
	);
}

/** R5-T1: GETs the slash-command catalog for the `command_catalog` status
 * event — `[]` on ANY failure (network error, a 404 on an older server
 * without this route), never throws; the adapter skips emitting on an empty
 * result (unlike `fetchServeAgents`, there's no static fallback list — an
 * empty catalog is just "this server has none"). */
export async function fetchServeCommands(
	http: ServeHttp
): Promise<OpencodeServeCommand[]> {
	try {
		return parseOpencodeServeCommands(await http.getJson("/command"));
	} catch {
		return [];
	}
}

/** Serve has no stateful mode-setter route we trust (ASSUMPTION, unverified:
 * `POST /session/:id/mode` is documented as deprecated in favor of a
 * per-message `agent` field — see opencode-serve.ts's
 * `makeServeControls.send`) — `setPermissionMode` just stores the chosen name
 * here for `send` to ride on every subsequent turn; mirrors `ServeModelRef`'s
 * pattern one file over. */
export interface ServeAgentRef {
	current?: string;
}
