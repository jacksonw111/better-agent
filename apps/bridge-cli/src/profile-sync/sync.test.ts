import { expect, it } from "vitest";
import type { ProfileBundle } from "./bundle";
import { MANAGED_BEGIN, MANAGED_END } from "./claude-md";
import { createFakeFs, type FakeFs } from "./fake-fs";
import type { SyncRoots } from "./fs-ports";
import { syncProfile } from "./sync";

const ROOTS: SyncRoots = {
	betterAgentDir: "/home/.better-agent",
	claudeDir: "/home/.claude",
};
const CLAUDE_MD = "/home/.claude/CLAUDE.md";
const MCP_JSON = "/home/.claude/.mcp.json";
const SETTINGS = "/home/.claude/settings.json";
const STATE = "/home/.better-agent/profile-state.json";

function bundle(over: Partial<ProfileBundle> = {}): ProfileBundle {
	return {
		mcpServers: [],
		skills: [],
		standards: [],
		templates: [],
		version: 1,
		...over,
	};
}

function run(
	fs: FakeFs,
	b: ProfileBundle,
	extra: Record<string, unknown> = {}
) {
	return syncProfile({
		bridgeToken: "bt_secret",
		fetchBundle: () => Promise.resolve(b),
		fs,
		roots: ROOTS,
		serverUrl: "https://api.example.test/",
		...extra,
	});
}

it("lands standards into a fresh CLAUDE.md managed block", async () => {
	const fs = createFakeFs();
	await run(fs, bundle({ standards: [std("No logs", "Remove console.log.")] }));
	const text = fs.get(CLAUDE_MD) ?? "";
	expect(text).toContain(`${MANAGED_BEGIN}`);
	expect(text).toContain("## No logs");
	expect(text).toContain("Remove console.log.");
});

it("replaces only the managed block, preserving user content around it", async () => {
	const fs = createFakeFs({
		[CLAUDE_MD]: `mine\n${MANAGED_BEGIN}\nOLD\n${MANAGED_END}\ntail\n`,
	});
	await run(fs, bundle({ standards: [std("New", "fresh rule")] }));
	const text = fs.get(CLAUDE_MD) ?? "";
	expect(text).toContain("mine");
	expect(text).toContain("tail");
	expect(text).toContain("fresh rule");
	expect(text).not.toContain("OLD");
});

it("reflects a removed standard on the next sync", async () => {
	const fs = createFakeFs();
	await run(fs, bundle({ standards: [std("A", "aa"), std("B", "bb")] }));
	await run(fs, bundle({ standards: [std("A", "aa")], version: 2 }));
	const text = fs.get(CLAUDE_MD) ?? "";
	expect(text).toContain("## A");
	expect(text).not.toContain("## B");
});

it("writes user MCP servers plus the memory entry into .mcp.json", async () => {
	const fs = createFakeFs();
	await run(
		fs,
		bundle({
			mcpServers: [
				{
					headers: { Authorization: "x" },
					id: "1",
					name: "weather",
					url: "https://w.test",
				},
			],
		})
	);
	const json = JSON.parse(fs.get(MCP_JSON) ?? "{}");
	expect(json.mcpServers.weather.url).toBe("https://w.test");
	expect(json.mcpServers.memory.url).toBe(
		"https://api.example.test/mcp/memory"
	);
	expect(json.mcpServers.memory.headers.Authorization).toBe("Bearer bt_secret");
});

it("binds the memory entry to a project when projectId is given", async () => {
	const fs = createFakeFs();
	await run(fs, bundle(), { projectId: "proj-9" });
	const json = JSON.parse(fs.get(MCP_JSON) ?? "{}");
	expect(json.mcpServers.memory.headers["x-better-agent-project-id"]).toBe(
		"proj-9"
	);
});

it("skips a re-sync when the version is unchanged", async () => {
	const fs = createFakeFs();
	await run(fs, bundle({ version: 5 }));
	const before = fs.get(STATE);
	const result = await run(fs, bundle({ version: 5 }));
	expect(result.changed).toBe(false);
	expect(fs.get(STATE)).toBe(before);
});

it("re-lands when the version changes", async () => {
	const fs = createFakeFs();
	await run(fs, bundle({ version: 1 }));
	const result = await run(fs, bundle({ version: 2 }));
	expect(result.changed).toBe(true);
	expect(JSON.parse(fs.get(STATE) ?? "{}").version).toBe(2);
});

it("re-lands an unchanged version when force is set", async () => {
	const fs = createFakeFs();
	await run(fs, bundle({ version: 5 }));
	const result = await run(fs, bundle({ version: 5 }), { force: true });
	expect(result.changed).toBe(true);
});

it("injects hooks into settings.json when a hook command path is given", async () => {
	const fs = createFakeFs();
	await run(fs, bundle(), { hookCommandPath: "/opt/agent-cli" });
	const settings = JSON.parse(fs.get(SETTINGS) ?? "{}");
	expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
		'"/opt/agent-cli" hook-emit SessionStart'
	);
	expect(settings.hooks.Stop[0].hooks[0].command).toBe(
		'"/opt/agent-cli" hook-emit Stop'
	);
});

it("preserves existing settings.json keys when injecting hooks", async () => {
	const fs = createFakeFs({
		[SETTINGS]: JSON.stringify({ model: "opus" }),
	});
	await run(fs, bundle(), { hookCommandPath: "/opt/agent-cli" });
	const settings = JSON.parse(fs.get(SETTINGS) ?? "{}");
	expect(settings.model).toBe("opus");
	expect(settings.hooks.PreToolUse).toBeDefined();
});

it("does not write settings.json without a hook command path", async () => {
	const fs = createFakeFs();
	await run(fs, bundle());
	expect(fs.get(SETTINGS)).toBeUndefined();
});

function std(title: string, body: string) {
	return { body, enabled: true, sortOrder: 0, title };
}
