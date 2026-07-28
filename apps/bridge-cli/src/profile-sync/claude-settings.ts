// Observability slice B: inject our Claude Code hooks into `~/.claude/
// settings.json` (which claude auto-loads on spawn, so no `--settings` flag is
// needed). Every hook event points at `agent-cli hook-emit <Event>`, so a
// backgrounded claude reports its activity_state to the daemon.
//
// We manage ONLY our own hook entries and preserve everything else: other
// top-level settings keys are copied through untouched, and for each event any
// hook group the user defined stays — we filter out only OUR prior group (a
// command-string carrying the `hook-emit` marker) and re-append a fresh one, so
// repeated syncs are idempotent and never duplicate.

/** The hook events we register (spike-tested set + SubagentStop/Notification,
 * which map defensively). matcher `""` = all (per the spike's examples). */
export const HOOK_EVENTS = [
	"SessionStart",
	"UserPromptSubmit",
	"PreToolUse",
	"PostToolUse",
	"Notification",
	"Stop",
	"SubagentStop",
	"SessionEnd",
] as const;

/** Distinctive substring identifying a hook command as ours. */
const HOOK_EMIT_MARKER = "hook-emit";

interface HookCommandEntry {
	command: string;
	type: string;
}

interface HookGroup {
	hooks?: HookCommandEntry[];
	matcher?: string;
}

function isOurGroup(group: unknown): boolean {
	if (!group || typeof group !== "object") {
		return false;
	}
	const hooks = (group as HookGroup).hooks;
	if (!Array.isArray(hooks)) {
		return false;
	}
	return hooks.some(
		(entry) =>
			entry !== null &&
			typeof entry === "object" &&
			typeof (entry as HookCommandEntry).command === "string" &&
			(entry as HookCommandEntry).command.includes(HOOK_EMIT_MARKER)
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges our managed hooks into an existing settings object (or null for a fresh
 * file), returning a new object. User keys and user-defined hook groups are
 * preserved; our prior groups are replaced in place (idempotent). `commandFor`
 * builds the shell command for a given event name.
 */
export function mergeHookSettings(
	existing: Record<string, unknown> | null,
	commandFor: (event: string) => string
): Record<string, unknown> {
	const result: Record<string, unknown> = existing ? { ...existing } : {};
	const priorHooks = isPlainObject(existing?.hooks) ? existing.hooks : {};
	const hooks: Record<string, unknown> = { ...priorHooks };
	for (const event of HOOK_EVENTS) {
		const groups = Array.isArray(hooks[event])
			? (hooks[event] as unknown[])
			: [];
		const userGroups = groups.filter((group) => !isOurGroup(group));
		const ourGroup: HookGroup = {
			matcher: "",
			hooks: [{ type: "command", command: commandFor(event) }],
		};
		hooks[event] = [...userGroups, ourGroup];
	}
	result.hooks = hooks;
	return result;
}

/** The shell command a hook event fires: the CLI's own executable + the
 * `hook-emit` subcommand + the event name. Quoted so a path with spaces still
 * runs under the shell claude invokes the hook through. */
export function hookCommand(executablePath: string, event: string): string {
	return `"${executablePath}" hook-emit ${event}`;
}
