#!/usr/bin/env node
// One-click release for @jacksonw111/agent-client.
//
//   pnpm -F @jacksonw111/agent-client release <patch|minor|major|x.y.z>
//
// Pre-flights (typecheck + test + build), bumps the version, commits, tags
// `client-v<version>`, and pushes — the tag triggers the GitHub Packages
// release workflow. Aborts before tagging if anything fails or the tree is dirty.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgJsonPath = resolve(pkgDir, "package.json");
const sh = (cmd, opts = {}) =>
	execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts });
const shIO = (cmd, opts = {}) =>
	execSync(cmd, { stdio: "inherit", cwd: pkgDir, ...opts });

function fail(message) {
	process.stderr.write(`✗ ${message}\n`);
	process.exit(1);
}

const bump = process.argv[2];
if (!bump) {
	fail(
		"Usage: pnpm -F @jacksonw111/agent-client release <patch|minor|major|x.y.z>"
	);
}

// A clean tree keeps the release commit limited to the version bump.
if (sh("git status --porcelain").trim()) {
	fail("Working tree not clean — commit or stash changes first.");
}

// Validate before we tag, so a failing build never gets a pushed tag.
process.stdout.write("→ Pre-flight: typecheck, test, build…\n");
shIO("pnpm run check-types");
shIO("pnpm run test");
shIO("pnpm run build");

shIO(`npm version ${bump} --no-git-tag-version`);
const { version } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
const tag = `client-v${version}`;

shIO(`git add "${pkgJsonPath}"`);
shIO(`git commit -m "chore(client): release v${version}"`);
shIO(`git tag ${tag}`);
shIO("git push origin HEAD");
shIO(`git push origin ${tag}`);

process.stdout.write(
	`\n✓ Pushed ${tag}. The release workflow will publish ${version} to GitHub Packages.\n`
);
