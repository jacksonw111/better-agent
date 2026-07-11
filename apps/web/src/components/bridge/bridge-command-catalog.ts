// Split out of bridge-session-status.ts purely to keep that file under the
// repo's max-lines-per-file gate — mirrors bridge-session-list.ts. Not
// re-exported back from there (that would make the two files circularly
// depend on each other) — consumers import these symbols from this file
// directly.
import type { StreamEvent } from "./bridge-events";
import {
	asOptionalString,
	isRecord,
	latestStatusDetail,
} from "./bridge-session-status";

/** Pushed by each adapter (claude-code/pi/opencode-serve — see
 * `apps/bridge-cli/src/adapters/*.ts`) once its slash-command catalog is
 * known: once at session start for pi/opencode-serve, once at start AND on
 * every mid-session change for claude-code (the SDK's `commands_changed`
 * push — see `claude-code-commands.ts`'s doc comment). Each emission is a
 * full REPLACEMENT of the catalog, not a delta — `latestCommandCatalogDetail`
 * below always reads the most recent one. R5-T2 renders this; this task only
 * parses + stores it. */
export const COMMAND_CATALOG_STATUS = "command_catalog";

/** One slash command an adapter's underlying agent exposes. `source` is
 * adapter-specific provenance (pi's "extension"/"prompt"/"skill"; absent for
 * claude-code/opencode-serve, which don't report one). */
export interface CommandCatalogEntry {
	description?: string;
	name: string;
	source?: string;
}

export interface CommandCatalogDetail {
	commands: CommandCatalogEntry[];
}

function asOptionalCommandCatalogEntries(
	value: unknown
): CommandCatalogEntry[] | undefined {
	if (!Array.isArray(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const entries: CommandCatalogEntry[] = [];
	for (const item of value) {
		if (isRecord(item) && typeof item.name === "string") {
			entries.push({
				name: item.name,
				description: asOptionalString(item.description),
				source: asOptionalString(item.source),
			});
		}
	}
	return entries;
}

export function parseCommandCatalogDetail(
	detail: unknown
): CommandCatalogDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	const commands = asOptionalCommandCatalogEntries(detail.commands);
	return commands === undefined ? null : { commands };
}

/** The latest `command_catalog` detail on the feed — `null` before any
 * adapter has emitted one (or the one that did was malformed). Scans from
 * the tail, so a claude-code `commands_changed` REPLACEMENT push always wins
 * over the initial one. */
export function latestCommandCatalogDetail(
	events: StreamEvent[]
): CommandCatalogDetail | null {
	const detail = latestStatusDetail(events, COMMAND_CATALOG_STATUS);
	return detail === undefined ? null : parseCommandCatalogDetail(detail);
}
