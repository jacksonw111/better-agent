import type { BundleStandard } from "./bundle";

// P1-C (DP3): the `~/.claude/CLAUDE.md` managed block. The user's own content
// lives OUTSIDE the `# BEGIN better-agent managed` … `# END better-agent
// managed` markers and is never touched; the sync only ever rewrites the block
// interior. A file with no block yet gets one appended; a file with one gets
// its interior replaced in place — both idempotent.

export const MANAGED_BEGIN = "# BEGIN better-agent managed";
export const MANAGED_END = "# END better-agent managed";

// Matches the whole managed block (markers included) so it can be swapped as a
// unit. `[\s\S]*?` is a non-greedy any-including-newlines match; built inline
// once from the constant markers (no user input) so there is no regex-injection
// concern.
const MANAGED_BLOCK = new RegExp(
	`${MANAGED_BEGIN}\\n[\\s\\S]*?\\n${MANAGED_END}`
);

/** Renders the block interior: every ENABLED standard, ordered by `sortOrder`
 * (then original order), each as a `## title` heading followed by its body. */
export function renderManagedBlock(standards: BundleStandard[]): string {
	const enabled = standards
		.filter((standard) => standard.enabled)
		.sort((a, b) => a.sortOrder - b.sortOrder);
	return enabled
		.map((standard) => `## ${standard.title}\n\n${standard.body.trim()}`)
		.join("\n\n");
}

function wrap(blockBody: string): string {
	return `${MANAGED_BEGIN}\n${blockBody}\n${MANAGED_END}`;
}

/**
 * Merges the managed block carrying `blockBody` into `existing`:
 * - `existing` null/empty → the block alone (trailing newline).
 * - already has a block → its interior is replaced, everything else untouched.
 * - no block yet → the block is appended after the user's content.
 */
export function mergeManagedBlock(
	existing: string | null,
	blockBody: string
): string {
	const block = wrap(blockBody);
	if (!existing || existing.trim() === "") {
		return `${block}\n`;
	}
	if (MANAGED_BLOCK.test(existing)) {
		return existing.replace(MANAGED_BLOCK, block);
	}
	const separator = existing.endsWith("\n") ? "\n" : "\n\n";
	return `${existing}${separator}${block}\n`;
}
