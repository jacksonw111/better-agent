import type { ProjectRow } from "@better-agent/agent/project-ports";

// Helpers shared by the Projects routers (projects.ts create/read/delete and
// projects-edit.ts update/retryClone): the git-URL shapes the server accepts,
// the display-name derivation, and the explicit user-facing projection.

export const NAME_MAX_LENGTH = 120;
export const TOKEN_LAST4 = 4;
/** scp-like ssh remote: `git@host:path(.git)` — user@host:path, no spaces. */
const SSH_REPO_URL_PATTERN = /^[\w.-]+@[\w.-]+:\S+$/;
const LEADING_SLASHES = /^\/+/;
const TRAILING_SLASHES = /\/+$/;
const GIT_SUFFIX = /\.git$/;

export const hasVisibleText = (value: string) => value.trim().length > 0;

/** Parses `value` as an http(s) URL, or null for anything else (including the
 * ssh form, which the URL constructor rejects). */
function parseHttpGitUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}

/** Any host is fine — the only accepted shapes are an http(s) URL and the
 * scp-like ssh remote. */
export function isValidGitUrl(value: string): boolean {
	return parseHttpGitUrl(value) !== null || SSH_REPO_URL_PATTERN.test(value);
}

/** The display name stored in `repo_full_name`: host stripped, path minus
 * `.git` — `owner/repo`, `group/sub/repo`, and the same for the ssh form. */
export function repoDisplayName(repoUrl: string): string {
	const httpUrl = parseHttpGitUrl(repoUrl);
	const path = httpUrl
		? httpUrl.pathname
		: repoUrl.slice(repoUrl.indexOf(":") + 1);
	const trimmed = path
		.replace(LEADING_SLASHES, "")
		.replace(TRAILING_SLASHES, "")
		.replace(GIT_SUFFIX, "");
	return trimmed === "" ? repoUrl : trimmed;
}

/** Explicit field list so `encryptedToken` can never leak into a user-facing
 * response by accident — the credential surface is tokenLast4 only. */
export function toListedProject(row: ProjectRow) {
	return {
		computerId: row.computerId,
		createdAt: row.createdAt,
		errorMessage: row.errorMessage,
		id: row.id,
		localPath: row.localPath,
		name: row.name,
		repoCloneUrl: row.repoCloneUrl,
		repoFullName: row.repoFullName,
		status: row.status,
		tokenLast4: row.tokenLast4,
		updatedAt: row.updatedAt,
	};
}
