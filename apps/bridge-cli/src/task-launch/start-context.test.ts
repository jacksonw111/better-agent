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

// P0: agent-browser / agent-device are managed tools like git/gh, so they get
// the same installed-fact line — plus ONE orientation line each, because
// unlike git the agent cannot be assumed to know they exist. Still facts, not
// tutorials: the agent runs `--help` for the rest.
describe("buildTaskStartContext - agent tool orientation", () => {
	it("adds a single usage line after each new tool's fact line", async () => {
		const context = await buildTaskStartContext(
			{
				description: "d",
				issueSnapshots: [],
				toolInventory: [
					{ installed: true, name: "agent-browser" },
					{ installed: true, name: "agent-device" },
				],
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toBe(`d

## Agent environment
- agent-browser is installed and managed by Better Agent.
- It drives a browser from the shell and keeps state in a daemon across commands: \`agent-browser open <url>\` then \`agent-browser snapshot -i\` prints a compact accessibility tree whose \`@ref\` handles later commands act on; run \`agent-browser --help\` for the rest.
- agent-device is installed and managed by Better Agent.
- It drives iOS/Android devices and simulators from the shell; run \`agent-device devices\` to see what this machine actually has and \`agent-device --help\` for the rest.
- Authentication and current health have not been preflighted; actual command output is authoritative.
- Task workspace: ${WORKSPACE}`);
	});

	it("omits the usage line when the tool is not installed", async () => {
		const context = await buildTaskStartContext(
			{
				description: "d",
				issueSnapshots: [],
				toolInventory: [{ installed: false, name: "agent-browser" }],
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).not.toContain("agent-browser");
	});
});

describe("buildTaskStartContext - GitHub block", () => {
	it("renders the Repository line and issue sections between description and environment", async () => {
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
				repositoryUrl: "https://github.com/a/b",
				toolInventory: BOTH_TOOLS,
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toBe(`Fix the bug.

## GitHub context
Repository: https://github.com/a/b

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

describe("buildTaskStartContext - Repository line variants", () => {
	it("renders the Repository line alone for a repository task without issues", async () => {
		const context = await buildTaskStartContext(
			{
				description: "d",
				issueSnapshots: [],
				repositoryUrl: "https://github.com/a/b",
				toolInventory: [],
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toContain(
			"d\n\n## GitHub context\nRepository: https://github.com/a/b\n\n## Agent environment"
		);
	});

	it("omits the Repository line when the payload has none (repositoryUrl null)", async () => {
		const context = await buildTaskStartContext(
			{
				description: "d",
				issueSnapshots: [
					{
						body: "b",
						number: 7,
						title: "T",
						url: "https://github.com/a/b/issues/7",
					},
				],
				repositoryUrl: null,
				toolInventory: [],
				workspacePath: WORKSPACE,
			},
			identityResolve
		);
		expect(context).toContain("## GitHub context\n\n### Issue #7: T");
		expect(context).not.toContain("Repository:");
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
