// P4-T4: pure parsing for `git status --porcelain=v1 -b` output — the branch
// header line plus one `XY path` entry per changed file. Kept free of any
// process/exec concern so the parser is trivially testable; git-runner.ts owns
// spawning git and pushing the parsed summary back over the relay.

/** One changed file. `x` is the staged (index) status char, `y` the
 * worktree one, exactly as porcelain v1 prints them (`?`/`?` = untracked).
 * A rename/copy keeps its source as `origPath` (`R  old -> new`). */
export interface GitStatusEntry {
	origPath?: string;
	path: string;
	x: string;
	y: string;
}

export interface GitStatusSummary {
	ahead?: number;
	behind?: number;
	branch: string;
	entries: GitStatusEntry[];
	truncated: boolean;
}

/** Entry cap per `git_status` reply — a monster working tree answers with the
 * first 400 and `truncated: true` (the byte fit in git-runner.ts may shrink
 * further, same reasoning as fs-reader.ts's `MAX_LIST_DETAIL_BYTES`). */
export const MAX_STATUS_ENTRIES = 400;

const XY_WIDTH = 2;
const ENTRY_PATH_START = 3;
const AHEAD_RE = /\[ahead (\d+)/;
const BEHIND_RE = /(?:\[|, )behind (\d+)/;
const NO_COMMITS_PREFIX = "## No commits yet on ";
const ESCAPE_RE = /\\(.)/g;
const UNESCAPES: Record<string, string> = { n: "\n", t: "\t" };

/** Porcelain quotes paths containing specials (`"a b\"c.txt"`); strip the
 * quotes and undo the C-style escapes it uses (`\"`, `\\`, `\t`, `\n`). */
function unquote(raw: string): string {
	if (!(raw.startsWith('"') && raw.endsWith('"'))) {
		return raw;
	}
	return raw
		.slice(1, -1)
		.replace(ESCAPE_RE, (_, char: string) => UNESCAPES[char] ?? char);
}

/** The `## …` header → branch name + ahead/behind counts. Handles
 * `## main...origin/main [ahead 1, behind 2]`, plain `## main`,
 * `## HEAD (no branch)` (detached) and `## No commits yet on main`. */
function parseBranchHeader(line: string): {
	ahead?: number;
	behind?: number;
	branch: string;
} {
	const body = line.slice(ENTRY_PATH_START);
	if (line.startsWith(NO_COMMITS_PREFIX)) {
		return { branch: line.slice(NO_COMMITS_PREFIX.length) };
	}
	const branch = body.split("...")[0] ?? body;
	const ahead = AHEAD_RE.exec(body)?.[1];
	const behind = BEHIND_RE.exec(body)?.[1];
	return {
		ahead: ahead === undefined ? undefined : Number(ahead),
		behind: behind === undefined ? undefined : Number(behind),
		branch,
	};
}

/** One porcelain entry line (`XY path`, or `XY old -> new` for renames). */
function parseEntryLine(line: string): GitStatusEntry {
	const x = line[0] ?? " ";
	const y = line[1] ?? " ";
	const rest = line.slice(ENTRY_PATH_START);
	const arrow = rest.indexOf(" -> ");
	if (arrow === -1) {
		return { path: unquote(rest), x, y };
	}
	return {
		origPath: unquote(rest.slice(0, arrow)),
		path: unquote(rest.slice(arrow + " -> ".length)),
		x,
		y,
	};
}

/** Parses the full `git status --porcelain=v1 -b` output into a summary,
 * capping entries at `MAX_STATUS_ENTRIES`. */
export function parseStatusPorcelain(output: string): GitStatusSummary {
	const lines = output.split("\n").filter((line) => line.length > XY_WIDTH);
	const header = lines[0]?.startsWith("## ")
		? parseBranchHeader(lines[0])
		: { branch: "" };
	const entryLines = lines[0]?.startsWith("## ") ? lines.slice(1) : lines;
	const entries = entryLines
		.slice(0, MAX_STATUS_ENTRIES)
		.map((line) => parseEntryLine(line));
	return {
		...header,
		entries,
		truncated: entryLines.length > MAX_STATUS_ENTRIES,
	};
}
