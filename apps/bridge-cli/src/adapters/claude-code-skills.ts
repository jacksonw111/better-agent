import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedSkill } from "./types";

// R4: installs a session's resolved skills as SKILL.md files under the
// project's `.claude/skills/<name>/SKILL.md`, which the claude SDK discovers
// on start (its default `settingSources` loads project settings) and enables
// via the `skills` query option. Split out of claude-code.ts to keep that file
// under the repo's 300-line gate.

// A skill directory name must be a single safe path segment — the SDK matches
// it against the SKILL.md `name`. Anything outside this set is replaced so a
// server-supplied name can never escape `.claude/skills/` (path traversal) or
// collide with the frontmatter delimiter.
const UNSAFE_NAME_CHARS = /[^a-zA-Z0-9._-]+/g;
const LEADING_DOTS_DASHES = /^[-.]+/;

function safeSkillDirName(name: string): string {
	return (
		name.replace(UNSAFE_NAME_CHARS, "-").replace(LEADING_DOTS_DASHES, "") ||
		"skill"
	);
}

/** Renders one skill as SKILL.md: YAML frontmatter (name + description, the
 * two fields the SDK reads to list a skill) followed by the instructions as
 * the markdown body. `description` is quoted so a colon or `#` in it can't
 * break the YAML. */
function skillMarkdown(skill: ResolvedSkill): string {
	const description = JSON.stringify(skill.description);
	return `---\nname: ${safeSkillDirName(skill.name)}\ndescription: ${description}\n---\n\n${skill.instructions}\n`;
}

/**
 * Writes each resolved skill to `<dir>/.claude/skills/<name>/SKILL.md` and
 * returns the sanitized directory names actually written — the exact list to
 * pass to the SDK `skills` query option so only these are enabled. A skill
 * whose file write fails is skipped (and left out of the returned names)
 * rather than aborting the whole session start.
 */
export async function writeSkillFiles(
	dir: string,
	skills: ResolvedSkill[] | undefined
): Promise<string[]> {
	const written: string[] = [];
	for (const skill of skills ?? []) {
		const dirName = safeSkillDirName(skill.name);
		const skillDir = join(dir, ".claude", "skills", dirName);
		try {
			await mkdir(skillDir, { recursive: true });
			await writeFile(join(skillDir, "SKILL.md"), skillMarkdown(skill));
			written.push(dirName);
		} catch {
			// A single unwritable skill must not sink the session — skip it.
		}
	}
	return written;
}
