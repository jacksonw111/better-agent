import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeSkillFiles } from "./claude-code-skills";

// R4: writeSkillFiles renders a session's resolved skills to
// .claude/skills/<name>/SKILL.md. Top-level its (no describe wrapper) to stay
// under the repo's 50-line-per-function eslint gate.

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ba-skills-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

it("writes each skill as .claude/skills/<name>/SKILL.md with frontmatter", async () => {
	const written = await writeSkillFiles(dir, [
		{
			name: "pdf",
			description: "Work with PDF files",
			instructions: "# PDF\nUse pdftotext.",
		},
	]);

	expect(written).toEqual(["pdf"]);
	const content = await readFile(
		join(dir, ".claude", "skills", "pdf", "SKILL.md"),
		"utf8"
	);
	expect(content).toBe(
		'---\nname: pdf\ndescription: "Work with PDF files"\n---\n\n# PDF\nUse pdftotext.\n'
	);
});

it("returns the written names to enable (one dir per skill)", async () => {
	const written = await writeSkillFiles(dir, [
		{ name: "pdf", description: "d1", instructions: "i1" },
		{ name: "docx", description: "d2", instructions: "i2" },
	]);
	expect(written).toEqual(["pdf", "docx"]);
});

it("sanitizes an unsafe name so it can't escape .claude/skills", async () => {
	const written = await writeSkillFiles(dir, [
		{ name: "../../etc/evil", description: "d", instructions: "i" },
	]);
	// No path traversal: the name collapses to a single safe segment.
	expect(written).toEqual(["etc-evil"]);
	const content = await readFile(
		join(dir, ".claude", "skills", "etc-evil", "SKILL.md"),
		"utf8"
	);
	expect(content).toContain("name: etc-evil");
});

it("quotes the description so a colon can't break the YAML frontmatter", async () => {
	await writeSkillFiles(dir, [
		{ name: "s", description: "a: b # c", instructions: "i" },
	]);
	const content = await readFile(
		join(dir, ".claude", "skills", "s", "SKILL.md"),
		"utf8"
	);
	expect(content).toContain('description: "a: b # c"');
});

it("no skills → writes nothing and returns an empty list", async () => {
	expect(await writeSkillFiles(dir, undefined)).toEqual([]);
	expect(await writeSkillFiles(dir, [])).toEqual([]);
});
