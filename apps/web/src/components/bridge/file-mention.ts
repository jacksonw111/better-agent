import type { FsEntry } from "./fs-events";

// P4-T3: pure parsing/insertion for the composer's @file picker (the "@"
// sibling of slash-picker.ts's "/" query). V1 scope: the picker opens for an
// `@`-led token at the END of the composer text (cursor assumed at the end,
// like the slash picker works off the whole text); typed `/` segments select
// which workspace directory is listed, the last segment prefix-filters it.

/** A trailing `@token` query: `@src/comp` → dirPath "src", prefix "comp". */
export interface FileMentionQuery {
	/** The workspace-relative directory the picker should list ("" = root). */
	dirPath: string;
	/** The (possibly empty) last path segment, prefix-matched against entries. */
	prefix: string;
	/** Index of the `@` itself in the composer text — insertion rewrites from
	 * here. */
	start: number;
}

/** An `@` at the start or after whitespace, followed by a space-free,
 * `@`-free token, at the very end of the text. */
const MENTION_RE = /(^|\s)@([^\s@]*)$/;

export function parseFileMention(text: string): FileMentionQuery | null {
	const match = MENTION_RE.exec(text);
	if (!match) {
		return null;
	}
	const raw = match[2] ?? "";
	const slash = raw.lastIndexOf("/");
	return {
		dirPath: slash === -1 ? "" : raw.slice(0, slash),
		prefix: slash === -1 ? raw : raw.slice(slash + 1),
		start: match.index + (match[1]?.length ?? 0),
	};
}

/** Rewrites the trailing query with the picked entry: a file inserts
 * `@dir/name ` (trailing space closes the picker), a directory inserts
 * `@dir/name/` (keeping the picker open on that directory's listing). */
export function applyFileMention(
	text: string,
	query: FileMentionQuery,
	entry: FsEntry
): string {
	const path =
		query.dirPath === "" ? entry.name : `${query.dirPath}/${entry.name}`;
	const head = text.slice(0, query.start);
	return entry.type === "dir" ? `${head}@${path}/` : `${head}@${path} `;
}

/** Case-insensitive prefix filter over one directory's entries, capped for
 * the dropdown. */
export function filterMentionEntries(
	entries: FsEntry[],
	prefix: string,
	limit: number
): FsEntry[] {
	const needle = prefix.toLowerCase();
	return entries
		.filter((entry) => entry.name.toLowerCase().startsWith(needle))
		.slice(0, limit);
}
