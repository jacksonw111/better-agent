// Structural shrinking for the two CONTROL-PLANE status events that must
// never degrade to `event_truncated` (see truncate-event.ts, which calls this
// as its last resort before degrading): `session_ready` — the capability
// handshake the web's Git/Files/Shell gates, model picker, and permission
// menu all hang off — and `command_catalog`, the slash-command list. Both
// carry machine-inventory-sized arrays (tools, skills, slash commands with
// descriptions), so on a plugin-heavy machine they can exceed the server's
// per-event byte cap on structure alone: measured 51_827 bytes for a real
// 162-command catalog (2026-07-19 resume-caps investigation), which the old
// wholesale degrade silently replaced with an opaque `event_truncated` — the
// web lost the entire catalog, and the same fate awaited `session_ready` on a
// bigger inventory. Field-level string truncation can't help (the detail is a
// structured object, not one long string), so this module shrinks the
// structure itself, sacrificing exactly the parts the web can best live
// without.

import { isRecord, type StatusEvent } from "./normalize/types";

/** Mirrors `MAX_EVENT_BYTES` in `packages/api/src/routers/bridge.ts` (the
 * server rejects a whole pushEvents batch over this) — lives here so both
 * this module and truncate-event.ts share one copy. Keep in sync. */
export const MAX_EVENT_BYTES = 32_768;

/** Serialized size of `value` in UTF-8 bytes, as JSON — mirrors `byteSizeOf`
 * in `packages/api/src/routers/bridge.ts`. */
export function byteSizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function fits(event: StatusEvent): boolean {
	return byteSizeOf(event) <= MAX_EVENT_BYTES;
}

const DESCRIPTION_CAP_LOOSE = 200;
const DESCRIPTION_CAP_MEDIUM = 100;
const DESCRIPTION_CAP_TIGHT = 50;

/** Escalating per-description character caps tried in order when the whole
 * catalog is over the byte cap — the loosest that fits wins, so descriptions
 * survive as long as the machine's command count allows. */
const COMMAND_DESCRIPTION_CAPS = [
	DESCRIPTION_CAP_LOOSE,
	DESCRIPTION_CAP_MEDIUM,
	DESCRIPTION_CAP_TIGHT,
] as const;

const HALF = 2;

/** The catalog's commands with each description capped (0 drops descriptions
 * entirely) — names are kept verbatim (they're what the picker matches on). */
function cappedCommands(
	commands: unknown[],
	descriptionCap: number
): Record<string, unknown>[] {
	return commands.filter(isRecord).map((command) => ({
		...command,
		description:
			typeof command.description === "string" && descriptionCap > 0
				? command.description.slice(0, descriptionCap)
				: undefined,
	}));
}

function withCommands(
	event: StatusEvent,
	detail: Record<string, unknown>,
	commands: Record<string, unknown>[]
): StatusEvent {
	return { ...event, detail: { ...detail, commands } };
}

/** Shrinks in escalating steps, each sacrificing less-essential data: cap
 * every description (loosest fitting cap wins) → drop descriptions entirely
 * (names alone still drive the picker) → drop the list's tail, halving until
 * it fits. Head-first, deterministic. */
function shrinkCommandCatalog(
	event: StatusEvent,
	detail: Record<string, unknown>
): StatusEvent | undefined {
	if (!Array.isArray(detail.commands)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	for (const cap of COMMAND_DESCRIPTION_CAPS) {
		const candidate = withCommands(
			event,
			detail,
			cappedCommands(detail.commands, cap)
		);
		if (fits(candidate)) {
			return candidate;
		}
	}
	let commands = cappedCommands(detail.commands, 0);
	let candidate = withCommands(event, detail, commands);
	while (!fits(candidate) && commands.length > 0) {
		commands = commands.slice(0, Math.floor(commands.length / HALF));
		candidate = withCommands(event, detail, commands);
	}
	return commands.length > 0 ? candidate : undefined;
}

/** `session_ready` detail fields shed (in this order) when the handshake is
 * over the byte cap — the machine-inventory lists, never the capability/
 * model/permission fields the web's gates and menus are driven by. */
const SESSION_READY_SHEDDABLE_FIELDS = [
	"tools",
	"skills",
	"slashCommands",
	"mcpServers",
] as const;

function shrinkSessionReady(
	event: StatusEvent,
	detail: Record<string, unknown>
): StatusEvent | undefined {
	let slim = detail;
	for (const field of SESSION_READY_SHEDDABLE_FIELDS) {
		if (!(field in slim)) {
			continue;
		}
		slim = Object.fromEntries(
			Object.entries(slim).filter(([key]) => key !== field)
		);
		const candidate: StatusEvent = { ...event, detail: slim };
		if (fits(candidate)) {
			return candidate;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/**
 * Last-resort structural shrink for a status event still over
 * `MAX_EVENT_BYTES` after truncate-event.ts's generic field truncation.
 * Returns the shrunk event, or `undefined` for a status this module doesn't
 * know how to shrink (the caller degrades it to `event_truncated` as before).
 */
export function shrinkOversizedStatusEvent(
	event: StatusEvent
): StatusEvent | undefined {
	if (!isRecord(event.detail)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	if (event.status === "command_catalog") {
		return shrinkCommandCatalog(event, event.detail);
	}
	if (event.status === "session_ready") {
		return shrinkSessionReady(event, event.detail);
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}
