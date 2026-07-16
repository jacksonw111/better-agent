import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type {
	GithubClient,
	GithubConnectionRow,
	GithubConnectionUpsert,
	GithubIssueDetail,
	GithubIssueSummary,
	GithubRepositorySummary,
} from "@better-agent/agent/github/github-ports";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "./index";

export const ALICE = {
	id: "a-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};

export const GOOD_TOKEN = "github_pat_good_abcd1234";
export const BAD_TOKEN = "github_pat_revoked_zzzz";

export const REPO_FIXTURE: GithubRepositorySummary = {
	fullName: "octo/hello",
	url: "https://github.com/octo/hello",
	defaultBranch: "main",
	cloneUrl: "https://github.com/octo/hello.git",
	private: false,
	description: "Says hello",
};

export const ISSUE_FIXTURE: GithubIssueSummary = {
	number: 7,
	title: "Crash on start",
	url: "https://github.com/octo/hello/issues/7",
	state: "open",
};

export const ISSUE_DETAIL_FIXTURE: GithubIssueDetail = {
	number: 7,
	title: "Crash on start",
	body: "Stack trace…",
	url: "https://github.com/octo/hello/issues/7",
};

export function memoryConnectionStore() {
	const rows: GithubConnectionRow[] = [];
	return {
		rows,
		upsert: (input: GithubConnectionUpsert) => {
			const existing = rows.findIndex((row) => row.userId === input.userId);
			if (existing >= 0) {
				rows.splice(existing, 1);
			}
			const row: GithubConnectionRow = {
				...input,
				id: crypto.randomUUID(),
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			rows.push(row);
			return Promise.resolve(row);
		},
		getByUser: (userId: string) =>
			Promise.resolve(rows.find((row) => row.userId === userId) ?? null),
		deleteByUser: (userId: string) => {
			const idx = rows.findIndex((row) => row.userId === userId);
			if (idx >= 0) {
				rows.splice(idx, 1);
			}
			return Promise.resolve();
		},
	};
}

/** Fake GithubClient (§19.6) recording call args; only GOOD_TOKEN verifies. */
function fakeGithubClient(token: string, calls: Record<string, unknown[]>) {
	const record = (name: string, args: unknown[]) => {
		calls[name] = args;
	};
	const client: GithubClient = {
		verifyToken: () =>
			Promise.resolve(token === GOOD_TOKEN ? { login: "octocat" } : null),
		searchRepositories: (query) => {
			record("searchRepositories", [query]);
			return Promise.resolve([REPO_FIXTURE]);
		},
		getRepositoryByFullName: (fullName) => {
			record("getRepositoryByFullName", [fullName]);
			return Promise.resolve(fullName === "octo/hello" ? REPO_FIXTURE : null);
		},
		searchIssues: (fullName, query) => {
			record("searchIssues", [fullName, query]);
			return Promise.resolve([ISSUE_FIXTURE]);
		},
		getIssue: (fullName, number) => {
			record("getIssue", [fullName, number]);
			return Promise.resolve(ISSUE_DETAIL_FIXTURE);
		},
	};
	return client;
}

export function buildGithubHarness() {
	const secretBox = createSecretBox("api-test-secret-key-please-32-chars");
	const store = memoryConnectionStore();
	const factoryTokens: string[] = [];
	const clientCalls: Record<string, unknown[]> = {};
	const services = {
		authz: { enabled: false },
		secretBox,
		githubClient: (token: string) => {
			factoryTokens.push(token);
			return fakeGithubClient(token, clientCalls);
		},
		stores: { githubConnection: store },
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: ALICE,
			clientIp: "127.0.0.1",
			userAgent: null,
			waitUntil: (p: Promise<unknown>) => {
				p.catch(() => undefined);
			},
		},
	});
	return { client, store, secretBox, factoryTokens, clientCalls };
}
