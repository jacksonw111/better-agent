import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { PATH_ESCAPE_MESSAGE, resolveWorkspacePath } from "./workspace-path";

// P4-T3: the fs channel's path confinement — `..` traversal, absolute paths,
// sibling-prefix lookalikes, and symlink escapes must all reject, while
// ordinary in-workspace paths (dotfiles included) resolve to real paths.

const ENOENT_RE = /ENOENT/;

let root = "";
let outside = "";

beforeAll(async () => {
	const base = await mkdtemp(path.join(tmpdir(), "workspace-path-"));
	root = path.join(base, "work");
	outside = path.join(base, "secret");
	await mkdir(path.join(root, "src"), { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(path.join(root, "src", "a.ts"), "export {};\n");
	await writeFile(path.join(root, ".env"), "SECRET=1\n");
	await writeFile(path.join(outside, "leak.txt"), "leak\n");
	await symlink(outside, path.join(root, "sneaky"));
	await symlink(path.join(outside, "leak.txt"), path.join(root, "sneaky-file"));
});

it("resolves the workspace root itself for empty and dot paths", async () => {
	await expect(resolveWorkspacePath(root, "")).resolves.toBeTruthy();
	await expect(resolveWorkspacePath(root, ".")).resolves.toBeTruthy();
});

it("resolves an ordinary nested file, dotfiles included", async () => {
	const nested = await resolveWorkspacePath(root, "src/a.ts");
	expect(nested.endsWith(path.join("src", "a.ts"))).toBe(true);
	await expect(resolveWorkspacePath(root, ".env")).resolves.toBeTruthy();
});

it("rejects .. traversal out of the workspace", async () => {
	await expect(
		resolveWorkspacePath(root, "../secret/leak.txt")
	).rejects.toThrow(PATH_ESCAPE_MESSAGE);
	await expect(
		resolveWorkspacePath(root, "src/../../secret/leak.txt")
	).rejects.toThrow(PATH_ESCAPE_MESSAGE);
});

it("rejects absolute paths outside the workspace", async () => {
	await expect(
		resolveWorkspacePath(root, path.join(outside, "leak.txt"))
	).rejects.toThrow(PATH_ESCAPE_MESSAGE);
});

it("rejects a sibling directory sharing the root's name prefix", async () => {
	// `${base}/work-evil` starts with `${base}/work` as a raw string but is NOT
	// under it — the path.sep guard must catch it.
	await expect(resolveWorkspacePath(root, "../work-evil")).rejects.toThrow(
		PATH_ESCAPE_MESSAGE
	);
});

it("rejects symlinks whose targets escape the workspace", async () => {
	await expect(resolveWorkspacePath(root, "sneaky")).rejects.toThrow(
		PATH_ESCAPE_MESSAGE
	);
	await expect(resolveWorkspacePath(root, "sneaky/leak.txt")).rejects.toThrow(
		PATH_ESCAPE_MESSAGE
	);
	await expect(resolveWorkspacePath(root, "sneaky-file")).rejects.toThrow(
		PATH_ESCAPE_MESSAGE
	);
});

it("rejects a missing target with the underlying fs error", async () => {
	await expect(resolveWorkspacePath(root, "nope.txt")).rejects.toThrow(
		ENOENT_RE
	);
});
