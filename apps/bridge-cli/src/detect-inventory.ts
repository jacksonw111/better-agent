import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ComputerRuntimeInventoryItem,
	ManagedToolInventoryItem,
	ManagedToolName,
	SkillSummary,
} from "@better-agent/agent/computer-ports";
import { AGENT_CLI } from "./adapters";
import { findOnPath } from "./adapters/process-io";
import type { AgentKind } from "./adapters/types";

// Inventory detection (D2): PATH-existence probes in a FIXED order — claude,
// opencode, codex, pi, git, gh — and nothing more. No `gh auth status`, no
// runtime activation, no health checks: the platform reports installed-or-not
// facts and never claims a binary is authenticated. claude-code is the only
// v1 runtime with discoverable skills (~/.claude/skills/*/SKILL.md).

const RUNTIME_PROBE_ORDER: AgentKind[] = [
	"claude-code",
	"opencode",
	"codex",
	"pi",
];
const MANAGED_TOOLS: ManagedToolName[] = ["git", "gh"];

export interface ComputerInventory {
	runtimeInventory: ComputerRuntimeInventoryItem[];
	toolInventory: ManagedToolInventoryItem[];
}

/** Every dependency is injectable for tests; production uses PATH lookup and
 * the real filesystem under `~/.claude/skills`. */
export interface DetectInventoryDeps {
	findExecutable?: (binary: string) => string | undefined;
	readDirNames?: (dir: string) => Promise<string[]>;
	readTextFile?: (path: string) => Promise<string>;
	skillsDir?: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;
const FRONTMATTER_FIELD = /^(name|description):\s*(.*)$/;

/** A frontmatter value may be a JSON-quoted string (how the bridge itself
 * writes SKILL.md files — see adapters/claude-code-skills.ts) or plain text. */
function unquote(value: string): string {
	if (!value.startsWith('"')) {
		return value;
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "string" ? parsed : value;
	} catch {
		return value;
	}
}

/** Exported for task-launch/skill-references.ts (S25-T1), which matches
 * Skill References against the SAME frontmatter-name-or-entry discovery this
 * module's inventory scan uses. */
export function parseSkillFrontmatter(content: string): {
	description?: string;
	name?: string;
} {
	const block = FRONTMATTER.exec(content)?.[1];
	if (block === undefined) {
		return {};
	}
	const fields: { description?: string; name?: string } = {};
	for (const line of block.split("\n")) {
		const match = FRONTMATTER_FIELD.exec(line);
		if (match?.[1] === "name") {
			fields.name = unquote((match[2] ?? "").trim());
		} else if (match?.[1] === "description") {
			fields.description = unquote((match[2] ?? "").trim());
		}
	}
	return fields;
}

// Scans `<skillsDir>/*/SKILL.md`. A missing directory is the normal "no
// skills installed" case (empty list); an unreadable single entry is skipped
// rather than sinking the whole inventory.
async function readClaudeSkills(
	deps: DetectInventoryDeps
): Promise<SkillSummary[]> {
	const dir = deps.skillsDir ?? join(homedir(), ".claude", "skills");
	const readDirNames = deps.readDirNames ?? ((d: string) => readdir(d));
	const readTextFile =
		deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));
	let entries: string[];
	try {
		entries = await readDirNames(dir);
	} catch {
		return [];
	}
	const skills: SkillSummary[] = [];
	for (const entry of entries) {
		try {
			const content = await readTextFile(join(dir, entry, "SKILL.md"));
			const frontmatter = parseSkillFrontmatter(content);
			skills.push({
				description: frontmatter.description ?? "",
				name: frontmatter.name ?? entry,
			});
		} catch {
			// Not a skill directory (or unreadable) — skip this entry only.
		}
	}
	return skills;
}

async function toRuntimeItem(
	agentKind: AgentKind,
	deps: DetectInventoryDeps
): Promise<ComputerRuntimeInventoryItem> {
	if (agentKind === "claude-code") {
		return {
			agentKind,
			skillCapability: "discoverable",
			skills: await readClaudeSkills(deps),
		};
	}
	return { agentKind, skillCapability: "none", skills: [] };
}

export async function detectComputerInventory(
	deps: DetectInventoryDeps = {}
): Promise<ComputerInventory> {
	const findExecutable = deps.findExecutable ?? findOnPath;
	const runtimeInventory: ComputerRuntimeInventoryItem[] = [];
	for (const agentKind of RUNTIME_PROBE_ORDER) {
		if (findExecutable(AGENT_CLI[agentKind].binary) === undefined) {
			continue;
		}
		runtimeInventory.push(await toRuntimeItem(agentKind, deps));
	}
	const toolInventory: ManagedToolInventoryItem[] = MANAGED_TOOLS.map(
		(name) => ({ installed: findExecutable(name) !== undefined, name })
	);
	return { runtimeInventory, toolInventory };
}
