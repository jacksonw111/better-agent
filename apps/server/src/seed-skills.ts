import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeDb } from "@better-agent/db/node-db";
import { createSkillStore } from "@better-agent/db/repositories/skill-store";
import { BUILTIN_SKILL_MANIFEST } from "./builtin-skills/manifest";

// Seeds (idempotently, by name) the org's built-in skills into the DB. Run from
// the deploy Action after migrations, alongside seed-admin. Built-in skills are
// ownerless (userId=null, isBuiltin=true): visible read-only to every user and
// assignable to their agents. Re-running refreshes the instructions in place,
// so editing a `.md` + redeploy propagates without breaking assignments.
async function seedSkills(): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error("seed-skills: DATABASE_URL is required");
	}

	// In the production image the bundle lives in dist/ and the .md files are
	// copied to BUILTIN_SKILLS_DIR (see deploy/docker/server.Dockerfile). In dev
	// (tsx src/seed-skills.ts) fall back to the sibling source folder.
	const skillsDir =
		process.env.BUILTIN_SKILLS_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), "builtin-skills");
	const db = createNodeDb(databaseUrl);
	const skills = createSkillStore(db);

	let seeded = 0;
	for (const entry of BUILTIN_SKILL_MANIFEST) {
		const instructions = readFileSync(
			join(skillsDir, entry.file),
			"utf8"
		).trim();
		if (instructions.length === 0) {
			throw new Error(`seed-skills: ${entry.file} is empty`);
		}
		await skills.upsertBuiltin({
			name: entry.name,
			description: entry.description,
			instructions,
			allowedTools: entry.allowedTools,
		});
		seeded++;
	}

	await db.$client.end();
	process.stdout.write(`seed-skills: upserted ${seeded} built-in skills\n`);
}

seedSkills().catch((error) => {
	process.stderr.write(`seed-skills failed: ${(error as Error).message}\n`);
	process.exit(1);
});
