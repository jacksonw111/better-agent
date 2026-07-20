import { describe, expect, it, vi } from "vitest";
import {
	assistedInstallCandidates,
	detectComputerInventory,
	MANAGED_TOOL_INSTALL,
} from "./detect-inventory";

// D2: PATH-existence probes in a FIXED order (claude, opencode, codex, pi,
// git, gh, agent-browser, agent-device) and nothing else — no `gh auth
// status`, no `agent-device doctor`, no runtime activation. claude-code is the
// only skill-discoverable runtime: its skills come from scanning
// <skillsDir>/*/SKILL.md frontmatter, injected here as fake fs.

function findOnly(binaries: string[]): (binary: string) => string | undefined {
	const installed = new Set(binaries);
	return (binary) => (installed.has(binary) ? `/bin/${binary}` : undefined);
}

const SKILL_MD = `---
name: research
description: "Deep research: fan-out searches"
---

Body instructions.
`;

describe("detectComputerInventory - probes", () => {
	it("probes exactly the fixed binary order with no auth preflight", async () => {
		const findExecutable = vi.fn(() => undefined);
		const inventory = await detectComputerInventory({ findExecutable });
		expect(findExecutable.mock.calls.flat()).toEqual([
			"claude",
			"opencode",
			"codex",
			"pi",
			"git",
			"gh",
			"agent-browser",
			"agent-device",
		]);
		expect(inventory.runtimeInventory).toEqual([]);
		expect(inventory.toolInventory).toEqual([
			{ installed: false, name: "git" },
			{ installed: false, name: "gh" },
			{ installed: false, name: "agent-browser" },
			{ installed: false, name: "agent-device" },
		]);
	});

	it("reports installed runtimes with their skill capability", async () => {
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["claude", "codex", "git", "agent-browser"]),
			readDirNames: () => Promise.reject(new Error("ENOENT")),
		});
		expect(inventory.runtimeInventory).toEqual([
			{ agentKind: "claude-code", skillCapability: "discoverable", skills: [] },
			{ agentKind: "codex", skillCapability: "none", skills: [] },
		]);
		expect(inventory.toolInventory).toEqual([
			{ installed: true, name: "git" },
			{ installed: false, name: "gh" },
			{ installed: true, name: "agent-browser" },
			{ installed: false, name: "agent-device" },
		]);
	});
});

// P0 (docs/research/2026-07-20-agent-browser-device-integration.md §E):
// agent-browser ships static binaries and is safe to offer as an assisted
// install; agent-device's real dependency is a full Xcode / Android SDK
// toolchain, so it is detected but NEVER offered for automatic installation.
describe("managed tool install eligibility", () => {
	it("marks agent-browser assisted and agent-device detect-only", () => {
		expect(MANAGED_TOOL_INSTALL["agent-browser"].assisted).toBe(true);
		expect(MANAGED_TOOL_INSTALL["agent-browser"].command).toBeDefined();
		expect(MANAGED_TOOL_INSTALL["agent-device"].assisted).toBe(false);
		expect(MANAGED_TOOL_INSTALL["agent-device"].command).toBeUndefined();
		expect(MANAGED_TOOL_INSTALL["agent-device"].note).toContain("Xcode");
		expect(MANAGED_TOOL_INSTALL["agent-device"].note).toContain("Android SDK");
	});

	it("never offers to install git or gh", () => {
		expect(MANAGED_TOOL_INSTALL.git.assisted).toBe(false);
		expect(MANAGED_TOOL_INSTALL.gh.assisted).toBe(false);
	});
});

describe("assistedInstallCandidates", () => {
	it("offers only missing tools that are assisted-installable", () => {
		expect(
			assistedInstallCandidates([
				{ installed: false, name: "git" },
				{ installed: false, name: "gh" },
				{ installed: false, name: "agent-browser" },
				{ installed: false, name: "agent-device" },
			])
		).toEqual(["agent-browser"]);
	});

	it("excludes tools that are already installed", () => {
		expect(
			assistedInstallCandidates([
				{ installed: true, name: "agent-browser" },
				{ installed: false, name: "agent-device" },
			])
		).toEqual([]);
	});
});

describe("detectComputerInventory - non-discoverable runtimes", () => {
	it("reports opencode and pi as skill capability none with no skills", async () => {
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["opencode", "pi"]),
		});
		expect(inventory.runtimeInventory).toEqual([
			{ agentKind: "opencode", skillCapability: "none", skills: [] },
			{ agentKind: "pi", skillCapability: "none", skills: [] },
		]);
	});
});

describe("detectComputerInventory - claude skills", () => {
	it("parses name and description from each SKILL.md frontmatter", async () => {
		const readTextFile = vi.fn((path: string) => {
			if (path === "/skills/research/SKILL.md") {
				return Promise.resolve(SKILL_MD);
			}
			return Promise.resolve(
				"---\nname: to-spec\ndescription: plain text\n---\nBody\n"
			);
		});
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["claude"]),
			readDirNames: () => Promise.resolve(["research", "to-spec"]),
			readTextFile,
			skillsDir: "/skills",
		});
		expect(inventory.runtimeInventory[0]?.skills).toEqual([
			{ description: "Deep research: fan-out searches", name: "research" },
			{ description: "plain text", name: "to-spec" },
		]);
	});

	it("falls back to the directory name when frontmatter is absent", async () => {
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["claude"]),
			readDirNames: () => Promise.resolve(["bare"]),
			readTextFile: () => Promise.resolve("No frontmatter here.\n"),
			skillsDir: "/skills",
		});
		expect(inventory.runtimeInventory[0]?.skills).toEqual([
			{ description: "", name: "bare" },
		]);
	});
});

describe("detectComputerInventory - claude skills resilience", () => {
	it("skips entries whose SKILL.md cannot be read", async () => {
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["claude"]),
			readDirNames: () => Promise.resolve(["broken", "research"]),
			readTextFile: (path: string) =>
				path.includes("broken")
					? Promise.reject(new Error("EISDIR"))
					: Promise.resolve(SKILL_MD),
			skillsDir: "/skills",
		});
		expect(inventory.runtimeInventory[0]?.skills).toEqual([
			{ description: "Deep research: fan-out searches", name: "research" },
		]);
	});

	it("returns no skills when the skills directory does not exist", async () => {
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["claude"]),
			readDirNames: () => Promise.reject(new Error("ENOENT")),
			skillsDir: "/skills",
		});
		expect(inventory.runtimeInventory[0]?.skills).toEqual([]);
	});
});
