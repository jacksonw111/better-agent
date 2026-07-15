// P4-T3: path confinement for the read-only fs channel (fs-reader.ts). Every
// web-supplied path is resolved against the CLI's validated workspace dir and
// rejected — BEFORE any fs read happens — when it escapes it, including via
// symlinks: the RESOLVED target's realpath must still sit under the workspace
// root's realpath. Dotfiles are listed like anything else; only paths landing
// outside the root are ever refused.

import { realpath } from "node:fs/promises";
import path from "node:path";

/** The one (deliberately unspecific) message every escape rejects with — no
 * echo of the resolved absolute path, so a probing request can't use the
 * error text to map the machine outside the workspace. */
export const PATH_ESCAPE_MESSAGE = "path escapes the workspace";

/** Whether `candidate` is `root` itself or strictly inside it — the
 * `path.sep` guard keeps a sibling like `/work-evil` from passing a bare
 * `startsWith("/work")` check. */
function isUnder(candidate: string, root: string): boolean {
	return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Resolves `relPath` (a web-supplied, workspace-relative path; `""`/`"."`
 * mean the root itself) against workspace `root`, rejecting anything that
 * escapes it. Two checks, both mandatory:
 *  1. lexical — `path.resolve` + prefix check catches `..` traversal and
 *     absolute paths pointing outside the root;
 *  2. physical — `fs.realpath` of the RESOLVED target must still be under
 *     the realpath'd root, which catches a symlink inside the workspace
 *     whose target lies outside it.
 * Returns the target's REAL path (what fs operations should then use).
 * Rejects with `PATH_ESCAPE_MESSAGE` on escape; a missing target rejects
 * with realpath's own ENOENT error.
 */
export async function resolveWorkspacePath(
	root: string,
	relPath: string
): Promise<string> {
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(resolvedRoot, relPath);
	if (!isUnder(resolved, resolvedRoot)) {
		throw new Error(PATH_ESCAPE_MESSAGE);
	}
	const [realRoot, realTarget] = await Promise.all([
		realpath(resolvedRoot),
		realpath(resolved),
	]);
	if (!isUnder(realTarget, realRoot)) {
		throw new Error(PATH_ESCAPE_MESSAGE);
	}
	return realTarget;
}
