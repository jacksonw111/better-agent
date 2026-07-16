import { describe, expect, it, vi } from "vitest";
import { detectComputerInventory } from "./detect-inventory";

// D2: PATH-existence probes in a FIXED order (claude, opencode, codex, pi,
// git, gh) and nothing else — no `gh auth status`, no runtime activation.
// claude-code is the only skill-discoverable runtime: its skills come from
// scanning <skillsDir>/*/SKILL.md frontmatter, injected here as fake fs.

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
		]);
		expect(inventory.runtimeInventory).toEqual([]);
		expect(inventory.toolInventory).toEqual([
			{ installed: false, name: "git" },
			{ installed: false, name: "gh" },
		]);
	});

	it("reports installed runtimes with their skill capability", async () => {
		const inventory = await detectComputerInventory({
			findExecutable: findOnly(["claude", "codex", "git", "gh"]),
			readDirNames: () => Promise.reject(new Error("ENOENT")),
		});
		expect(inventory.runtimeInventory).toEqual([
			{ agentKind: "claude-code", skillCapability: "discoverable", skills: [] },
			{ agentKind: "codex", skillCapability: "none", skills: [] },
		]);
		expect(inventory.toolInventory).toEqual([
			{ installed: true, name: "git" },
			{ installed: true, name: "gh" },
		]);
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
