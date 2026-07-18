import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Q2: where Project checkouts live and how a projectId maps back to its
// directory. The checkout dir is `<base>/projects/<projectId[:8]>-<repo short
// name>/`; because a launch payload carries the projectId ONLY (the server
// never dictates a path — see project-ports.ts), the clone step also records
// `projectId → localPath` in `<base>/projects/index.json`, and session
// launches / query execution resolve through that index instead of globbing.

/** How much of the projectId prefixes the checkout directory name. */
const PROJECT_DIR_ID_LENGTH = 8;
/** Directory-name characters we keep from the repo short name; anything
 * else (URL escapes, weird unicode) becomes `-`. */
const UNSAFE_DIR_CHARS = /[^\w.-]/g;
const GIT_SUFFIX = /\.git$/;
const TRAILING_SLASHES = /\/+$/;
const INDEX_JSON_INDENT = 2;

/** The managed root every project path hangs off — `~/.better-agent`. */
export function defaultProjectBasePath(): string {
	return join(homedir(), ".better-agent");
}

/** `<base>/projects` — checkouts plus the index file live here. */
export function projectsDir(basePath: string): string {
	return join(basePath, "projects");
}

/** `<base>/projects/index.json` — the projectId → localPath map. */
export function projectIndexPath(basePath: string): string {
	return join(projectsDir(basePath), "index.json");
}

/** The repository's short name from its clone URL — the last path segment
 * minus `.git`, sanitized for use in a directory name. */
export function repoShortName(cloneUrl: string): string {
	const last = cloneUrl.replace(TRAILING_SLASHES, "").split("/").pop() ?? "";
	const safe = last.replace(GIT_SUFFIX, "").replace(UNSAFE_DIR_CHARS, "-");
	return safe === "" ? "repo" : safe;
}

/** `<base>/projects/<projectId[:8]>-<repo short name>` — the checkout. */
export function projectCheckoutDir(
	basePath: string,
	projectId: string,
	repoCloneUrl: string
): string {
	const name = `${projectId.slice(0, PROJECT_DIR_ID_LENGTH)}-${repoShortName(repoCloneUrl)}`;
	return join(projectsDir(basePath), name);
}

/** The filesystem seams the index helpers use — injectable for tests. */
export interface ProjectIndexDeps {
	mkdirRecursive?: (path: string) => Promise<void>;
	readTextFile?: (path: string) => Promise<string>;
	writeTextFile?: (path: string, content: string) => Promise<void>;
}

function defaultReadTextFile(path: string): Promise<string> {
	return readFile(path, "utf8");
}

async function defaultWriteTextFile(
	path: string,
	content: string
): Promise<void> {
	await writeFile(path, content, "utf8");
}

async function defaultMkdirRecursive(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

/** Reads the index — a missing or corrupt file is an EMPTY index, never an
 * error: the next clone rewrites it, and a lookup miss reports the honest
 * "not cloned on this computer". */
export async function readProjectIndex(
	basePath: string,
	deps: ProjectIndexDeps = {}
): Promise<Record<string, string>> {
	const read = deps.readTextFile ?? defaultReadTextFile;
	try {
		const parsed: unknown = JSON.parse(await read(projectIndexPath(basePath)));
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return {};
		}
		const entries = Object.entries(parsed).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string"
		);
		return Object.fromEntries(entries);
	} catch {
		return {};
	}
}

/** Records one projectId → localPath mapping (read-modify-write). */
export async function writeProjectIndexEntry(
	basePath: string,
	projectId: string,
	localPath: string,
	deps: ProjectIndexDeps = {}
): Promise<void> {
	const mkdirRecursive = deps.mkdirRecursive ?? defaultMkdirRecursive;
	const write = deps.writeTextFile ?? defaultWriteTextFile;
	await mkdirRecursive(projectsDir(basePath));
	const index = await readProjectIndex(basePath, deps);
	index[projectId] = localPath;
	await write(
		projectIndexPath(basePath),
		JSON.stringify(index, null, INDEX_JSON_INDENT)
	);
}

/** The recorded checkout path for `projectId`, or null when this computer
 * has no record of it (never cloned here, or the index was wiped). */
export async function resolveProjectPath(
	basePath: string,
	projectId: string,
	deps: ProjectIndexDeps = {}
): Promise<string | null> {
	const index = await readProjectIndex(basePath, deps);
	return index[projectId] ?? null;
}
