import { expect, it } from "vitest";
import { HOOK_EVENTS, hookCommand, mergeHookSettings } from "./claude-settings";

const cmd = (event: string) => hookCommand("/opt/agent-cli", event);

function ourCommands(
	settings: Record<string, unknown>,
	event: string
): string[] {
	const hooks = settings.hooks as Record<string, unknown>;
	const groups =
		(hooks[event] as Array<{ hooks?: Array<{ command: string }> }>) ?? [];
	return groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command));
}

it("generates a group for every managed event from empty settings", () => {
	const merged = mergeHookSettings(null, cmd);
	for (const event of HOOK_EVENTS) {
		expect(ourCommands(merged, event)).toContain(
			`"/opt/agent-cli" hook-emit ${event}`
		);
	}
});

it("preserves unrelated user settings keys", () => {
	const merged = mergeHookSettings({ model: "opus", env: { FOO: "bar" } }, cmd);
	expect(merged.model).toBe("opus");
	expect(merged.env).toEqual({ FOO: "bar" });
});

it("preserves a user's own hook group for the same event alongside ours", () => {
	const existing = {
		hooks: {
			PreToolUse: [
				{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] },
			],
		},
	};
	const merged = mergeHookSettings(existing, cmd);
	const commands = ourCommands(merged, "PreToolUse");
	expect(commands).toContain("my-linter");
	expect(commands).toContain('"/opt/agent-cli" hook-emit PreToolUse');
});

it("is idempotent — re-merging does not duplicate our group", () => {
	const once = mergeHookSettings(null, cmd);
	const twice = mergeHookSettings(once, cmd);
	for (const event of HOOK_EVENTS) {
		const commands = ourCommands(twice, event).filter((c) =>
			c.includes("hook-emit")
		);
		expect(commands).toHaveLength(1);
	}
});

it("replaces a stale command when the executable path changes", () => {
	const first = mergeHookSettings(null, (e) => hookCommand("/old/cli", e));
	const second = mergeHookSettings(first, (e) => hookCommand("/new/cli", e));
	const commands = ourCommands(second, "Stop");
	expect(commands).toEqual(['"/new/cli" hook-emit Stop']);
});
