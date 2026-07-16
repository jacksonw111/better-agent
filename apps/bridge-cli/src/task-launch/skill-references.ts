import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "../adapters/types";
import {
	parseSkillFrontmatter,
	runtimeSkillCapability,
} from "../detect-inventory";

// S25-T1 (design D6, master spec §6.6/§10.2): client-side Skill Reference
// resolution — the single interface the Task Start Context assembly calls.
// `/name` tokens in the Description are matched against the SAME local skill
// discovery detect-inventory uses (~/.claude/skills/<entry>/SKILL.md, with
// the frontmatter `name` overriding the directory entry); a match inlines
// the SKILL.md body (frontmatter stripped) at the reference's position, an
// unknown `/text` stays plain text, and a missing skills directory simply
// resolves nothing (§6.6 — no hidden behavior, ever).

/** Every dependency is injectable for tests; production reads the real
 * `~/.claude/skills` directory. */
export interface SkillReferenceDeps {
	readDirNames(dir: string): Promise<string[]>;
	readTextFile(path: string): Promise<string>;
	skillsDir: string;
}

export function defaultSkillReferenceDeps(): SkillReferenceDeps {
	return {
		readDirNames: (dir) => readdir(dir),
		readTextFile: (path) => readFile(path, "utf8"),
		skillsDir: join(homedir(), ".claude", "skills"),
	};
}

/** A `/name` token counts as a reference only at the start of the text or
 * after whitespace — a URL's `/path` segment is never one (§6.6). */
const SKILL_REFERENCE = /(?<=^|\s)\/([a-z0-9][a-z0-9_-]*)/g;

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---\n?/;

/** The SKILL.md body: everything after the frontmatter block, trimmed. */
function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER_BLOCK, "").trim();
}

function referencedNames(description: string): Set<string> {
	const names = new Set<string>();
	for (const match of description.matchAll(SKILL_REFERENCE)) {
		const name = match[1];
		if (name !== undefined) {
			names.add(name);
		}
	}
	return names;
}

/** Discovers the local skill inventory (detect-inventory's logic: one
 * directory entry per skill, `SKILL.md` inside, frontmatter `name` winning
 * over the entry name) and returns name → body for the names in `wanted`.
 * A missing directory or an unreadable entry resolves to no skills — the
 * normal "nothing installed" case, never an error. */
async function loadSkillBodies(
	deps: SkillReferenceDeps,
	wanted: Set<string>
): Promise<Map<string, string>> {
	let entries: string[];
	try {
		entries = await deps.readDirNames(deps.skillsDir);
	} catch {
		return new Map();
	}
	const bodies = new Map<string, string>();
	for (const entry of entries) {
		try {
			const content = await deps.readTextFile(
				join(deps.skillsDir, entry, "SKILL.md")
			);
			const name = parseSkillFrontmatter(content).name ?? entry;
			if (wanted.has(name)) {
				bodies.set(name, stripFrontmatter(content));
			}
		} catch {
			// Not a skill directory (or unreadable) — skip this entry only.
		}
	}
	return bodies;
}

/**
 * Resolves the Description's Skill References in place (§10.2): each matched
 * `/name` is replaced by its SKILL.md body exactly where the reference
 * appears, preserving the surrounding text; unmatched references stay
 * verbatim. The single seam the start-context assembly depends on (D6).
 */
export async function resolveSkillReferences(
	description: string,
	deps: SkillReferenceDeps
): Promise<string> {
	const wanted = referencedNames(description);
	if (wanted.size === 0) {
		return description;
	}
	const bodies = await loadSkillBodies(deps, wanted);
	if (bodies.size === 0) {
		return description;
	}
	return description.replace(
		SKILL_REFERENCE,
		(token, name: string) => bodies.get(name) ?? token
	);
}

/**
 * D6/§10.2: the per-runtime resolver the start-context assembly gets. Skill
 * References only resolve for a runtime whose skill inventory capability is
 * `discoverable` (see `runtimeSkillCapability` — claude-code today); every
 * capability-`none` runtime gets the identity resolver, so a `/text` token in
 * the Description reaches it verbatim — the platform never fakes an expansion
 * for a runtime that has no skill inventory (§6.6).
 */
export function skillResolverForAgent(
	agentKind: AgentKind,
	deps: SkillReferenceDeps
): (description: string) => Promise<string> {
	if (runtimeSkillCapability(agentKind) !== "discoverable") {
		return (description) => Promise.resolve(description);
	}
	return (description) => resolveSkillReferences(description, deps);
}
