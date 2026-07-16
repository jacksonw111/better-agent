import { describe, expect, it, vi } from "vitest";
import { buildTaskStartContext } from "./start-context";

// S25-T1 (master spec §10.2): the Agent-facing Task Start Context = the
// skill-resolved description, an optional GitHub block (issue sections in the
// §10.1 format), and the `## Agent environment` template — installed-tool
// fact lines only for tools that ARE installed, the verbatim
// no-preflight sentence, and the absolute Task workspace path. Snapshot
// assertions below lock the exact assembled text.

const WORKSPACE = "/home/tester/.better-agent/tasks/task-1";

const BOTH_TOOLS = [
	{ installed: true, name: "git" as const },
	{ installed: true, name: "gh" as const },
];

const identityResolve = {
	resolveSkillReferences: (description: string) => Promise.resolve(description),
};

describe("buildTaskStartContext - environment template", () => {
	it("assembles description + §10.2 environment verbatim", async () => {
		const context = await buildTaskStartContext(
			{
				description: "Summarize the repo layout.",
				issueSnapshots: [],
				toolInventory: BOTH_TOOLS,
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toBe(`Summarize the repo layout.

## Agent environment
- git is installed and managed by Better Agent.
- gh is installed and managed by Better Agent.
- Authentication and current health have not been preflighted; actual command output is authoritative.
- Task workspace: ${WORKSPACE}`);
	});

	it("lists installed-tool facts only for tools that are installed", async () => {
		const context = await buildTaskStartContext(
			{
				description: "d",
				issueSnapshots: [],
				toolInventory: [
					{ installed: true, name: "git" },
					{ installed: false, name: "gh" },
				],
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toContain(
			"- git is installed and managed by Better Agent.\n- Authentication"
		);
		expect(context).not.toContain("gh is installed");
	});
});

describe("buildTaskStartContext - GitHub block", () => {
	it("inserts the issue sections between the description and the environment", async () => {
		const context = await buildTaskStartContext(
			{
				description: "Fix the bug.",
				issueSnapshots: [
					{
						body: "Steps to reproduce…",
						number: 7,
						title: "Crash on save",
						url: "https://github.com/a/b/issues/7",
					},
					{
						body: "Details",
						number: 9,
						title: "Follow-up",
						url: "https://github.com/a/b/issues/9",
					},
				],
				toolInventory: BOTH_TOOLS,
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toBe(`Fix the bug.

## GitHub context

### Issue #7: Crash on save
Steps to reproduce…
https://github.com/a/b/issues/7

### Issue #9: Follow-up
Details
https://github.com/a/b/issues/9

## Agent environment
- git is installed and managed by Better Agent.
- gh is installed and managed by Better Agent.
- Authentication and current health have not been preflighted; actual command output is authoritative.
- Task workspace: ${WORKSPACE}`);
	});
});

describe("buildTaskStartContext - skill resolution", () => {
	it("uses the resolver's output as the description", async () => {
		const resolveSkillReferences = vi.fn(() =>
			Promise.resolve("EXPANDED description")
		);
		const context = await buildTaskStartContext(
			{
				description: "/research it",
				issueSnapshots: [],
				toolInventory: [],
				workspacePath: WORKSPACE,
			},
			{ resolveSkillReferences }
		);
		expect(resolveSkillReferences).toHaveBeenCalledExactlyOnceWith(
			"/research it"
		);
		expect(context.startsWith("EXPANDED description\n\n")).toBe(true);
	});
});
