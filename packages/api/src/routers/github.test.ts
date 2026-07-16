import { expect, it } from "vitest";
import {
	BAD_TOKEN,
	buildGithubHarness,
	GOOD_TOKEN,
	ISSUE_DETAIL_FIXTURE,
	ISSUE_FIXTURE,
	REPO_FIXTURE,
} from "./github-test-helpers";

const REJECTED_PATTERN = /rejected/i;

it("connect verifies the token, stores it encrypted, and returns the login", async () => {
	const { client, store, secretBox } = buildGithubHarness();

	const result = await client.github.connect({ token: GOOD_TOKEN });
	expect(result).toEqual({ login: "octocat" });

	const row = store.rows[0];
	expect(row?.credentialType).toBe("pat");
	expect(row?.tokenLast4).toBe(GOOD_TOKEN.slice(-4));
	// Credential boundary: ciphertext at rest, plaintext round-trips only
	// through the secret box.
	expect(row?.encryptedToken).not.toContain(GOOD_TOKEN);
	expect(secretBox.decrypt(row?.encryptedToken ?? "")).toBe(GOOD_TOKEN);
});

it("connect rejects a bad token with BAD_REQUEST and stores nothing", async () => {
	const { client, store } = buildGithubHarness();
	await expect(client.github.connect({ token: BAD_TOKEN })).rejects.toThrow(
		REJECTED_PATTERN
	);
	expect(store.rows).toHaveLength(0);
});

it("status reports connection state and never leaks the token", async () => {
	const { client } = buildGithubHarness();

	expect(await client.github.status()).toEqual({ connected: false });

	await client.github.connect({ token: GOOD_TOKEN });
	const status = await client.github.status();
	expect(status).toEqual({
		connected: true,
		tokenLast4: GOOD_TOKEN.slice(-4),
	});
	expect(JSON.stringify(status)).not.toContain(GOOD_TOKEN);
});

it("disconnect removes the connection", async () => {
	const { client, store } = buildGithubHarness();
	await client.github.connect({ token: GOOD_TOKEN });
	expect(await client.github.disconnect()).toEqual({ ok: true });
	expect(store.rows).toHaveLength(0);
	expect(await client.github.status()).toEqual({ connected: false });
});

it("search and lookup require a connection (PRECONDITION_FAILED)", async () => {
	const { client } = buildGithubHarness();
	await expect(
		client.github.searchRepositories({ query: "hello" })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	await expect(
		client.github.lookupRepository({ url: "octo/hello" })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	await expect(
		client.github.searchIssues({ fullName: "octo/hello", query: "" })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	await expect(
		client.github.getIssue({ fullName: "octo/hello", number: 7 })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("searchRepositories runs the fake client with the decrypted token", async () => {
	const { client, factoryTokens, clientCalls } = buildGithubHarness();
	await client.github.connect({ token: GOOD_TOKEN });

	const repos = await client.github.searchRepositories({ query: "hello" });
	expect(repos).toEqual([REPO_FIXTURE]);
	expect(clientCalls.searchRepositories).toEqual(["hello"]);
	// The factory saw the connect token and then the decrypted stored token.
	expect(factoryTokens).toEqual([GOOD_TOKEN, GOOD_TOKEN]);
});

it("lookupRepository normalizes URLs and rejects non-GitHub input", async () => {
	const { client, clientCalls } = buildGithubHarness();
	await client.github.connect({ token: GOOD_TOKEN });

	const found = await client.github.lookupRepository({
		url: "https://github.com/octo/hello",
	});
	expect(found).toEqual(REPO_FIXTURE);
	expect(clientCalls.getRepositoryByFullName).toEqual(["octo/hello"]);

	await expect(
		client.github.lookupRepository({ url: "https://gitlab.com/octo/hello" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("searchIssues and getIssue pass through to the client", async () => {
	const { client, clientCalls } = buildGithubHarness();
	await client.github.connect({ token: GOOD_TOKEN });

	expect(
		await client.github.searchIssues({ fullName: "octo/hello", query: "crash" })
	).toEqual([ISSUE_FIXTURE]);
	expect(clientCalls.searchIssues).toEqual(["octo/hello", "crash"]);

	expect(
		await client.github.getIssue({ fullName: "octo/hello", number: 7 })
	).toEqual(ISSUE_DETAIL_FIXTURE);
	expect(clientCalls.getIssue).toEqual(["octo/hello", 7]);
});
