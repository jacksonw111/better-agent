// Fetch-based GitHub REST client (S4-T1, design D7). Deliberately not
// octokit: five read endpoints don't justify the dependency, and an
// injectable fetch keeps every test on fixtures (§19.6 — no real API, no
// real account). 401/403/404 resolve to null/[] (missing-or-inaccessible is
// a domain answer, not a fault); anything else throws with the real status.

import { z } from "zod";
import type {
	GithubClient,
	GithubIssueDetail,
	GithubIssueSummary,
	GithubRepositorySummary,
} from "./github-ports";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const MISSING_STATUSES = new Set([
	HTTP_UNAUTHORIZED,
	HTTP_FORBIDDEN,
	HTTP_NOT_FOUND,
]);
const PAGE_SIZE = 100;
const ISSUE_PAGE_SIZE = 50;

const UserSchema = z.object({ login: z.string() });

const RepositorySchema = z.object({
	full_name: z.string(),
	html_url: z.string(),
	default_branch: z.string(),
	clone_url: z.string(),
	private: z.boolean(),
	description: z.string().nullable().optional(),
});

const RepositorySearchSchema = z.object({
	items: z.array(RepositorySchema).default([]),
});

const IssueSchema = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	state: z.string(),
	body: z.string().nullable().optional(),
	pull_request: z.unknown().optional(),
});

const IssueSearchSchema = z.object({ items: z.array(IssueSchema).default([]) });

type RawRepository = z.infer<typeof RepositorySchema>;
type RawIssue = z.infer<typeof IssueSchema>;

function toRepositorySummary(raw: RawRepository): GithubRepositorySummary {
	return {
		fullName: raw.full_name,
		url: raw.html_url,
		defaultBranch: raw.default_branch,
		cloneUrl: raw.clone_url,
		private: raw.private,
		description: raw.description ?? null,
	};
}

function toIssueSummary(raw: RawIssue): GithubIssueSummary {
	return {
		number: raw.number,
		title: raw.title,
		url: raw.html_url,
		state: raw.state === "closed" ? "closed" : "open",
	};
}

function isPullRequest(raw: RawIssue): boolean {
	return raw.pull_request !== undefined;
}

export interface GithubClientOptions {
	baseUrl?: string;
	/** Injectable transport so tests run on fixtures, never the network. */
	fetchImpl?: typeof fetch;
	token: string;
}

/** GET a GitHub API path; null = 401/403/404 (missing or inaccessible),
 * other non-ok statuses throw with the real status preserved. */
type GetJson = (path: string) => Promise<unknown | null>;

function createGetJson(options: GithubClientOptions): GetJson {
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = options.baseUrl ?? GITHUB_API_BASE_URL;
	const headers = {
		authorization: `Bearer ${options.token}`,
		accept: "application/vnd.github+json",
		"x-github-api-version": GITHUB_API_VERSION,
	};
	return async (path) => {
		const response = await fetchImpl(`${baseUrl}${path}`, { headers });
		if (response.ok) {
			return await response.json();
		}
		if (MISSING_STATUSES.has(response.status)) {
			return null;
		}
		throw new Error(`GitHub API responded ${response.status} for ${path}`);
	};
}

const AFFILIATED_REPOS_PATH = `/user/repos?affiliation=${encodeURIComponent(
	"owner,collaborator,organization_member"
)}&sort=updated&per_page=${PAGE_SIZE}`;

async function listAffiliatedRepositories(
	getJson: GetJson,
	query: string
): Promise<GithubRepositorySummary[]> {
	const data = await getJson(AFFILIATED_REPOS_PATH);
	if (data === null) {
		return [];
	}
	const needle = query.toLowerCase();
	return z
		.array(RepositorySchema)
		.parse(data)
		.map(toRepositorySummary)
		.filter(
			(repo) => needle === "" || repo.fullName.toLowerCase().includes(needle)
		);
}

async function searchRepositories(
	getJson: GetJson,
	query: string
): Promise<GithubRepositorySummary[]> {
	const trimmed = query.trim();
	if (trimmed !== "") {
		const q = encodeURIComponent(`${trimmed} in:name fork:true`);
		const data = await getJson(`/search/repositories?q=${q}`);
		const hits =
			data === null
				? []
				: RepositorySearchSchema.parse(data).items.map(toRepositorySummary);
		if (hits.length > 0) {
			return hits;
		}
	}
	// Fallback (and the empty-query path): the caller's own affiliation —
	// search misses private/org repos the token can actually reach.
	return await listAffiliatedRepositories(getJson, trimmed);
}

async function listOpenIssues(
	getJson: GetJson,
	fullName: string
): Promise<GithubIssueSummary[]> {
	const data = await getJson(
		`/repos/${fullName}/issues?state=open&per_page=${ISSUE_PAGE_SIZE}`
	);
	if (data === null) {
		return [];
	}
	// The list endpoint interleaves PRs — a PR is not an issue.
	return z
		.array(IssueSchema)
		.parse(data)
		.filter((raw) => !isPullRequest(raw))
		.map(toIssueSummary);
}

async function searchIssues(
	getJson: GetJson,
	fullName: string,
	query: string
): Promise<GithubIssueSummary[]> {
	const trimmed = query.trim();
	if (trimmed === "") {
		return await listOpenIssues(getJson, fullName);
	}
	const q = encodeURIComponent(`repo:${fullName} is:issue ${trimmed}`);
	const data = await getJson(`/search/issues?q=${q}`);
	if (data === null) {
		return [];
	}
	return IssueSearchSchema.parse(data).items.map(toIssueSummary);
}

async function getIssue(
	getJson: GetJson,
	fullName: string,
	number: number
): Promise<GithubIssueDetail | null> {
	const data = await getJson(`/repos/${fullName}/issues/${number}`);
	if (data === null) {
		return null;
	}
	const raw = IssueSchema.parse(data);
	if (isPullRequest(raw)) {
		return null;
	}
	return {
		number: raw.number,
		title: raw.title,
		body: raw.body ?? "",
		url: raw.html_url,
	};
}

export function createGithubClient(options: GithubClientOptions): GithubClient {
	const getJson = createGetJson(options);
	return {
		async verifyToken() {
			const data = await getJson("/user");
			return data === null ? null : { login: UserSchema.parse(data).login };
		},
		searchRepositories: (query) => searchRepositories(getJson, query),
		async getRepositoryByFullName(fullName) {
			const data = await getJson(`/repos/${fullName}`);
			return data === null
				? null
				: toRepositorySummary(RepositorySchema.parse(data));
		},
		searchIssues: (fullName, query) => searchIssues(getJson, fullName, query),
		getIssue: (fullName, number) => getIssue(getJson, fullName, number),
	};
}
