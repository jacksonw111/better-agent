import { expect, it } from "vitest";
import { assembleOpeningMessage } from "./opening-message";

const BASE = {
	agentKind: "claude-code",
	computerName: "John's MacBook",
	description: "Fix the flaky login test",
	workspaceKind: "standalone",
} as const;

it("renders description first and Execution context last with no GitHub block omitted entirely", () => {
	const message = assembleOpeningMessage(BASE);

	expect(message).toBe(
		[
			"Fix the flaky login test",
			"",
			"## Execution context",
			"- Computer: John's MacBook",
			"- Agent Runtime: Claude Code",
			"- Workspace: managed task directory",
		].join("\n")
	);
	expect(message).not.toContain("## GitHub context");
});

it("renders the GitHub context block with the repository URL and a repository workspace label", () => {
	const message = assembleOpeningMessage({
		...BASE,
		repositoryUrl: "https://github.com/acme/app",
		workspaceKind: "repository",
	});

	expect(message).toBe(
		[
			"Fix the flaky login test",
			"",
			"## GitHub context",
			"Repository: https://github.com/acme/app",
			"",
			"## Execution context",
			"- Computer: John's MacBook",
			"- Agent Runtime: Claude Code",
			"- Workspace: repository workspace",
		].join("\n")
	);
});

it("renders one Issue block per snapshot, in the given order, with body and canonical URL", () => {
	const message = assembleOpeningMessage({
		...BASE,
		issues: [
			{
				body: "Login intermittently 500s.",
				number: 42,
				title: "Login fails",
				url: "https://github.com/acme/app/issues/42",
			},
			{
				body: "See failing CI run.",
				number: 7,
				title: "Flaky test",
				url: "https://github.com/acme/app/issues/7",
			},
		],
		repositoryUrl: "https://github.com/acme/app",
		workspaceKind: "repository",
	});

	expect(message).toBe(
		[
			"Fix the flaky login test",
			"",
			"## GitHub context",
			"Repository: https://github.com/acme/app",
			"",
			"### Issue #42: Login fails",
			"Login intermittently 500s.",
			"https://github.com/acme/app/issues/42",
			"",
			"### Issue #7: Flaky test",
			"See failing CI run.",
			"https://github.com/acme/app/issues/7",
			"",
			"## Execution context",
			"- Computer: John's MacBook",
			"- Agent Runtime: Claude Code",
			"- Workspace: repository workspace",
		].join("\n")
	);
});

it("keeps the description verbatim, including /skill references", () => {
	const description = "Research the market /deep-research then draft a memo";
	const message = assembleOpeningMessage({ ...BASE, description });

	expect(message.startsWith(description)).toBe(true);
	expect(message).toContain("/deep-research");
});

it("never omits the description even when it is only a /skill reference", () => {
	const message = assembleOpeningMessage({ ...BASE, description: "/research" });

	expect(message.startsWith("/research\n")).toBe(true);
});

it("omits the whole GitHub block (issues included) when there is no repository", () => {
	const message = assembleOpeningMessage({
		...BASE,
		issues: [
			{
				body: "b",
				number: 1,
				title: "t",
				url: "https://github.com/acme/app/issues/1",
			},
		],
	});

	expect(message).not.toContain("## GitHub context");
	expect(message).not.toContain("### Issue #1");
});

it("labels each supported runtime with its display name", () => {
	const cases = [
		["claude-code", "Claude Code"],
		["opencode", "OpenCode"],
		["codex", "Codex"],
		["pi", "Pi"],
	] as const;

	for (const [agentKind, label] of cases) {
		const message = assembleOpeningMessage({ ...BASE, agentKind });
		expect(message).toContain(`- Agent Runtime: ${label}`);
	}
});
