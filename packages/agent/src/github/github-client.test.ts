import { expect, it } from "vitest";
import { createGithubClient } from "./github-client";

interface RecordedCall {
	headers: Record<string, string>;
	url: string;
}

interface FakeRoute {
	body: unknown;
	status?: number;
}

// Fixture transport: routes are matched by pathname (+search), no network.
function fakeFetch(routes: Record<string, FakeRoute>, calls: RecordedCall[]) {
	const impl = (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1]
	) => {
		const url = new URL(String(input));
		const key = `${url.pathname}${url.search}`;
		calls.push({
			url: key,
			headers: Object.fromEntries(
				Object.entries((init?.headers ?? {}) as Record<string, string>)
			),
		});
		const route = routes[key];
		if (!route) {
			return Promise.resolve(
				new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })
			);
		}
		return Promise.resolve(
			new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
		);
	};
	return impl as typeof fetch;
}

function build(routes: Record<string, FakeRoute>) {
	const calls: RecordedCall[] = [];
	const client = createGithubClient({
		token: "ghp_fixture",
		fetchImpl: fakeFetch(routes, calls),
	});
	return { client, calls };
}

const SERVER_ERROR_PATTERN = /500/;

const REPO_FIXTURE = {
	full_name: "octo/hello",
	html_url: "https://github.com/octo/hello",
	default_branch: "main",
	clone_url: "https://github.com/octo/hello.git",
	private: false,
	description: "Says hello",
};

it("verifyToken returns the login and sends the PAT headers", async () => {
	const { client, calls } = build({
		"/user": { body: { login: "octocat" } },
	});
	expect(await client.verifyToken()).toEqual({ login: "octocat" });
	expect(calls[0]?.headers.authorization).toBe("Bearer ghp_fixture");
	expect(calls[0]?.headers["x-github-api-version"]).toBe("2022-11-28");
	expect(calls[0]?.headers.accept).toBe("application/vnd.github+json");
});

it("verifyToken returns null for a rejected token", async () => {
	const { client } = build({
		"/user": { status: 401, body: { message: "Bad credentials" } },
	});
	expect(await client.verifyToken()).toBeNull();
});

it("searchRepositories maps search hits", async () => {
	const q = encodeURIComponent("hello in:name fork:true");
	const { client, calls } = build({
		[`/search/repositories?q=${q}`]: { body: { items: [REPO_FIXTURE] } },
	});
	expect(await client.searchRepositories("hello")).toEqual([
		{
			fullName: "octo/hello",
			url: "https://github.com/octo/hello",
			defaultBranch: "main",
			cloneUrl: "https://github.com/octo/hello.git",
			private: false,
			description: "Says hello",
		},
	]);
	expect(calls).toHaveLength(1);
});

it("searchRepositories falls back to affiliation repos when search is empty", async () => {
	const q = encodeURIComponent("hello in:name fork:true");
	const affiliated =
		"/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&per_page=100";
	const { client } = build({
		[`/search/repositories?q=${q}`]: { body: { items: [] } },
		[affiliated]: {
			body: [REPO_FIXTURE, { ...REPO_FIXTURE, full_name: "octo/other" }],
		},
	});
	const found = await client.searchRepositories("hello");
	expect(found.map((r) => r.fullName)).toEqual(["octo/hello"]);
});

it("searchRepositories with an empty query lists affiliation repos", async () => {
	const affiliated =
		"/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&per_page=100";
	const { client, calls } = build({
		[affiliated]: { body: [REPO_FIXTURE] },
	});
	expect(await client.searchRepositories("  ")).toHaveLength(1);
	expect(calls).toHaveLength(1);
});

it("getRepositoryByFullName maps the repo and nulls a missing description", async () => {
	const { client } = build({
		"/repos/octo/hello": { body: { ...REPO_FIXTURE, description: null } },
	});
	const repo = await client.getRepositoryByFullName("octo/hello");
	expect(repo?.description).toBeNull();
	expect(repo?.private).toBe(false);
});

it("getRepositoryByFullName returns null on 404", async () => {
	const { client } = build({});
	expect(await client.getRepositoryByFullName("octo/missing")).toBeNull();
});

it("searchIssues with a query uses the search API scoped to the repo", async () => {
	const q = encodeURIComponent("repo:octo/hello is:issue crash");
	const { client } = build({
		[`/search/issues?q=${q}`]: {
			body: {
				items: [
					{
						number: 7,
						title: "Crash on start",
						html_url: "https://github.com/octo/hello/issues/7",
						state: "closed",
					},
				],
			},
		},
	});
	expect(await client.searchIssues("octo/hello", "crash")).toEqual([
		{
			number: 7,
			title: "Crash on start",
			url: "https://github.com/octo/hello/issues/7",
			state: "closed",
		},
	]);
});

it("searchIssues with an empty query lists open issues and drops PRs", async () => {
	const { client } = build({
		"/repos/octo/hello/issues?state=open&per_page=50": {
			body: [
				{
					number: 2,
					title: "Real issue",
					html_url: "https://github.com/octo/hello/issues/2",
					state: "open",
				},
				{
					number: 3,
					title: "A pull request",
					html_url: "https://github.com/octo/hello/pull/3",
					state: "open",
					pull_request: { url: "https://api.github.com/..." },
				},
			],
		},
	});
	const issues = await client.searchIssues("octo/hello", "");
	expect(issues.map((issue) => issue.number)).toEqual([2]);
});

it("getIssue normalizes a null body to empty string", async () => {
	const { client } = build({
		"/repos/octo/hello/issues/9": {
			body: {
				number: 9,
				title: "No body",
				html_url: "https://github.com/octo/hello/issues/9",
				state: "open",
				body: null,
			},
		},
	});
	expect(await client.getIssue("octo/hello", 9)).toEqual({
		number: 9,
		title: "No body",
		body: "",
		url: "https://github.com/octo/hello/issues/9",
	});
});

it("getIssue returns null for a pull request number", async () => {
	const { client } = build({
		"/repos/octo/hello/issues/3": {
			body: {
				number: 3,
				title: "A pull request",
				html_url: "https://github.com/octo/hello/pull/3",
				state: "open",
				body: "diff",
				pull_request: { url: "https://api.github.com/..." },
			},
		},
	});
	expect(await client.getIssue("octo/hello", 3)).toBeNull();
});

it("getIssue returns null when the repo is forbidden", async () => {
	const { client } = build({
		"/repos/octo/private/issues/1": {
			status: 403,
			body: { message: "Forbidden" },
		},
	});
	expect(await client.getIssue("octo/private", 1)).toBeNull();
});

it("throws with the real status on unexpected API failures", async () => {
	const { client } = build({
		"/user": { status: 500, body: { message: "boom" } },
	});
	await expect(client.verifyToken()).rejects.toThrow(SERVER_ERROR_PATTERN);
});
