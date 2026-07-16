// GitHub Connection domain ports (S4-T1, master spec §5.5 / design D7).
// The server-side GitHub Connection is a per-user fine-grained PAT used to
// search repositories and read issues when composing Task context. The
// credential boundary is a security contract: tokens are encrypted before
// they reach the store, and no API response ever carries a token back out.

/** Repository facts needed to pick a repo and later clone it (D5). */
export interface GithubRepositorySummary {
	cloneUrl: string;
	defaultBranch: string;
	description: string | null;
	fullName: string;
	private: boolean;
	url: string;
}

/** A search hit — just enough to pick an issue in the wizard. */
export interface GithubIssueSummary {
	number: number;
	state: "open" | "closed";
	title: string;
	url: string;
}

/** Snapshot material for a Run: title/body/url, never comments (§19.6). */
export interface GithubIssueDetail {
	/** GitHub returns null for empty bodies; normalized to "". */
	body: string;
	number: number;
	title: string;
	url: string;
}

/** Read-side GitHub operations, always scoped by the connection's PAT.
 * Implementations return null / empty arrays for missing or inaccessible
 * resources (401/403/404) — only transport-level failures throw. */
export interface GithubClient {
	/** A pull request is NOT an issue — PR numbers resolve to null. */
	getIssue(fullName: string, number: number): Promise<GithubIssueDetail | null>;
	getRepositoryByFullName(
		fullName: string
	): Promise<GithubRepositorySummary | null>;
	/** Empty query = most recent open issues of the repository. */
	searchIssues(fullName: string, query: string): Promise<GithubIssueSummary[]>;
	/** Repositories the token's user can access; empty query = recent repos. */
	searchRepositories(query: string): Promise<GithubRepositorySummary[]>;
	verifyToken(): Promise<{ login: string } | null>;
}

/** v1 ships PAT only; the field exists so a GitHub App can slot in later
 * without touching the Task side (§5.5). */
export type GithubCredentialType = "pat";

export interface GithubConnectionUpsert {
	credentialType: GithubCredentialType;
	/** secret-box ciphertext — callers encrypt BEFORE handing the token over. */
	encryptedToken: string;
	tokenLast4: string;
	userId: string;
}

export interface GithubConnectionRow extends GithubConnectionUpsert {
	createdAt: Date;
	id: string;
	updatedAt: Date;
}

/** One connection per user (user_id is unique) — upsert replaces the token. */
export interface GithubConnectionStore {
	deleteByUser(userId: string): Promise<void>;
	/** Includes encryptedToken — server-internal use only, never serialized. */
	getByUser(userId: string): Promise<GithubConnectionRow | null>;
	upsert(input: GithubConnectionUpsert): Promise<GithubConnectionRow>;
}

const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const SSH_REMOTE_PATTERN = /^git@github\.com:([^/]+)\/([^/]+)$/;
const WEB_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/;
const GIT_SUFFIX = /\.git$/;
const SHORTHAND_SEGMENTS = 2;

function toFullName(
	owner: string | undefined,
	repo: string | undefined
): string | null {
	if (!(owner && repo)) {
		return null;
	}
	const bareRepo = repo.replace(GIT_SUFFIX, "");
	if (!(OWNER_PATTERN.test(owner) && REPO_PATTERN.test(bareRepo))) {
		return null;
	}
	return `${owner}/${bareRepo}`;
}

/** Normalizes a github.com URL (web or ssh) or an `owner/repo` shorthand to
 * a `owner/repo` fullName; anything else — including other hosts — is null. */
export function parseRepositoryUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}
	const ssh = SSH_REMOTE_PATTERN.exec(trimmed);
	if (ssh) {
		return toFullName(ssh[1], ssh[2]);
	}
	const web = WEB_URL_PATTERN.exec(trimmed);
	if (web?.[1]) {
		// Deep links (issues/tree/…) still identify the repo by their first
		// two path segments.
		const [owner, repo] = web[1].split("/");
		return toFullName(owner, repo === "" ? undefined : repo);
	}
	const segments = trimmed.split("/");
	if (segments.length !== SHORTHAND_SEGMENTS) {
		return null;
	}
	return toFullName(segments[0], segments[1]);
}
