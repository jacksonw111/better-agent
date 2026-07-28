import { join } from "node:path";
import type { ProfileBundle } from "./bundle";
import { mergeManagedBlock, renderManagedBlock } from "./claude-md";
import { hookCommand, mergeHookSettings } from "./claude-settings";
import type { SyncFs, SyncRoots } from "./fs-ports";
import { buildMemoryEntry, landMcpServers } from "./mcp-land";
import { readProfileState, writeProfileState } from "./profile-state";
import { landSkills } from "./skills-land";

// P1-C (DP3): the `agent-cli sync` orchestrator. Pulls the server Profile
// bundle, and unless its `version` already matches the landed state (or
// `--force`), lands it idempotently into `~/.claude`:
//   - CLAUDE.md  → the managed block (user content outside it untouched)
//   - skills/    → one SKILL.md per skill (removed ones cleaned via manifest)
//   - .mcp.json  → user MCP servers + the memory entry (user entries preserved)
// then records the version + manifests in `~/.better-agent/profile-state.json`.

const CLAUDE_MD = "CLAUDE.md";
const CLAUDE_SETTINGS = "settings.json";

export interface SyncDeps {
	/** Optional bridge token so the landed memory MCP entry can authenticate
	 * (Bearer). Absent → the entry lands url-only; see `buildMemoryEntry`. */
	bridgeToken?: string;
	/** Pulls the read-only bundle — `profiles.materializeBundle` in production,
	 * injected so the landing logic is tested without a network. */
	fetchBundle(): Promise<ProfileBundle>;
	/** Re-land even when the version is unchanged. */
	force?: boolean;
	fs: SyncFs;
	/** Slice B: the CLI's own executable path — used to build the hook commands
	 * injected into `~/.claude/settings.json`. Absent → hook injection is skipped
	 * (e.g. a caller with no stable executable path). */
	hookCommandPath?: string;
	log?(message: string): void;
	/** A project session binds the memory MCP to this project (P1-B). */
	projectId?: string;
	roots: SyncRoots;
	/** Server base URL — used to build the memory MCP endpoint. */
	serverUrl: string;
}

export interface SyncResult {
	/** True when a full land happened; false when skipped as up to date. */
	changed: boolean;
	version: number;
}

async function landClaudeMd(
	deps: SyncDeps,
	bundle: ProfileBundle
): Promise<void> {
	const path = join(deps.roots.claudeDir, CLAUDE_MD);
	const existing = await deps.fs.readFile(path);
	const merged = mergeManagedBlock(
		existing,
		renderManagedBlock(bundle.standards)
	);
	await deps.fs.mkdir(deps.roots.claudeDir);
	await deps.fs.writeFile(path, merged);
}

/** Slice B: inject our hooks into `~/.claude/settings.json`, preserving every
 * other setting and any user-defined hooks. Skipped when no executable path is
 * given; a settings.json that isn't a JSON object is left untouched (we never
 * clobber a file we can't safely merge into). */
async function landClaudeSettings(deps: SyncDeps): Promise<void> {
	if (!deps.hookCommandPath) {
		return;
	}
	const path = join(deps.roots.claudeDir, CLAUDE_SETTINGS);
	const existing = await deps.fs.readFile(path);
	let parsed: Record<string, unknown> | null = null;
	if (existing !== null && existing.trim() !== "") {
		try {
			const value: unknown = JSON.parse(existing);
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				deps.log?.("settings.json is not a JSON object — skipping hooks.");
				return;
			}
			parsed = value as Record<string, unknown>;
		} catch {
			deps.log?.("settings.json is not valid JSON — skipping hooks.");
			return;
		}
	}
	const executablePath = deps.hookCommandPath;
	const merged = mergeHookSettings(parsed, (event) =>
		hookCommand(executablePath, event)
	);
	await deps.fs.mkdir(deps.roots.claudeDir);
	await deps.fs.writeFile(path, `${JSON.stringify(merged, null, 2)}\n`);
}

/**
 * Runs one sync. When the bundle's `version` equals the last landed version and
 * `force` is not set, it returns `changed:false` without writing — the fast,
 * idempotent no-op path a project-session auto-sync hits on every launch after
 * the first.
 */
export async function syncProfile(deps: SyncDeps): Promise<SyncResult> {
	const bundle = await deps.fetchBundle();
	const state = await readProfileState(deps.fs, deps.roots);
	if (!deps.force && state?.version === bundle.version) {
		deps.log?.(`Profile v${bundle.version} already synced — skipping.`);
		return { changed: false, version: bundle.version };
	}
	await landClaudeMd(deps, bundle);
	await landClaudeSettings(deps);
	const skills = await landSkills(
		deps.fs,
		deps.roots,
		bundle.skills,
		state?.skills ?? []
	);
	const memory = buildMemoryEntry(
		deps.serverUrl,
		deps.bridgeToken,
		deps.projectId
	);
	const mcp = await landMcpServers(
		deps.fs,
		deps.roots,
		bundle.mcpServers,
		memory,
		state?.mcp ?? []
	);
	await writeProfileState(deps.fs, deps.roots, {
		claudeMd: { managed: true },
		mcp,
		skills,
		version: bundle.version,
	});
	deps.log?.(`Synced Profile v${bundle.version} into ${deps.roots.claudeDir}.`);
	return { changed: true, version: bundle.version };
}
