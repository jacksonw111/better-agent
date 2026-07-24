import { join } from "node:path";
import {
	safeSkillDirName,
	skillMarkdown,
} from "../adapters/claude-code-skills";
import type { BundleSkill } from "./bundle";
import type { SyncFs, SyncRoots } from "./fs-ports";

// P1-C (DP3): lands the user's skill set as `~/.claude/skills/<name>/SKILL.md`,
// reusing claude-code-skills.ts's `safeSkillDirName` + `skillMarkdown` (the same
// rendering a session install uses) so a globally-synced skill is byte-identical
// to a session-installed one. Cleanup is manifest-driven: only skill dirs THIS
// tool wrote last time (`previousNames`) and that are gone now are removed, so a
// skill the user dropped in by hand is never deleted.

function skillsRoot(roots: SyncRoots): string {
	return join(roots.claudeDir, "skills");
}

/**
 * Writes each skill's `SKILL.md`, then removes any previously-managed skill
 * directory no longer in the bundle. Returns the sanitized directory names
 * actually written — the next `profile-state.json` manifest.
 */
export async function landSkills(
	fs: SyncFs,
	roots: SyncRoots,
	skills: BundleSkill[],
	previousNames: string[]
): Promise<string[]> {
	const root = skillsRoot(roots);
	const written: string[] = [];
	const writtenSet = new Set<string>();
	for (const skill of skills) {
		const dirName = safeSkillDirName(skill.name);
		if (writtenSet.has(dirName)) {
			continue;
		}
		const skillDir = join(root, dirName);
		await fs.mkdir(skillDir);
		await fs.writeFile(join(skillDir, "SKILL.md"), skillMarkdown(skill));
		written.push(dirName);
		writtenSet.add(dirName);
	}
	for (const previous of previousNames) {
		if (!writtenSet.has(previous)) {
			await fs.rm(join(root, previous));
		}
	}
	return written;
}
