// opencode serve: parses `GET /command` — R5-T1's command_catalog surface.
// Kept beside normalize/opencode-serve.ts (mirrors opencode-serve-agent.ts)
// so neither file exceeds the repo's 300-line cap; consumed by
// adapters/opencode-serve-agent.ts's `fetchServeCommands`.
//
// ASSUMPTION (unverified — no `opencode` binary in this sandbox): `GET
// /command` responds an array of `{ name, description?: string, ... }` —
// mirrors the shape `GET /agent` uses for its own name/description pairs;
// reverify against the installed opencode server before relying on this.

import { asString, isRecord } from "./types";

export interface OpencodeServeCommand {
	description?: string;
	name: string;
}

function isOpencodeServeCommand(entry: unknown): entry is OpencodeServeCommand {
	return isRecord(entry) && typeof entry.name === "string";
}

/** Extracts `{name, description?}` entries from a `GET /command` response for
 * the `command_catalog` status event — `[]` (NOT a thrown error) for
 * anything off-shape (not an array, entries missing `name`), so the
 * adapter's `fetchServeCommands` can treat an empty result the same as a
 * request failure (skip emitting). */
export function parseOpencodeServeCommands(
	raw: unknown
): OpencodeServeCommand[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter(isOpencodeServeCommand).map((entry) => ({
		name: entry.name,
		description: asString(entry.description),
	}));
}
