// P4-T5: the generic JSONL transcript scan behind codex/pi/claude's
// `searchSessions` — split out of session-search.ts (which keeps the wire
// reply + snippet/caps layer) for the repo's 300-line file cap. Streams the
// newest transcript files line-by-line through one provider-supplied
// `JsonlSearchFormat`, dropping a file as soon as its header names another
// project, until the session cap or the caller's deadline is hit.

import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { FileWithMtime } from "./session-history-files";
import {
	buildSnippet,
	SEARCH_SESSION_CAP,
	SEARCH_SNIPPET_CAP,
	type SessionSearchHit,
	type SessionSearchOutcome,
	type SessionSearchSnippet,
} from "./session-search";

/** How one provider's JSONL transcript lines map onto the generic scan —
 * codex/pi/claude implementations live in session-search-providers.ts. */
export interface JsonlSearchFormat {
	/** The session header (id + cwd) if this parsed line carries it. */
	header(line: unknown): { cwd?: string; id?: string } | undefined;
	/** Every searchable message text on this parsed line. */
	texts(line: unknown): SessionSearchSnippet[];
	/** A session-title candidate from this parsed line (first one wins). */
	title(line: unknown): string | undefined;
}

/** Per-file accumulator: the header (only kept once it names THIS project),
 * the title candidate, and up to SEARCH_SNIPPET_CAP matching snippets. */
interface ScanAccumulator {
	header?: { cwd?: string; id?: string };
	snippets: SessionSearchSnippet[];
	title?: string;
}

function collectSnippets(
	acc: ScanAccumulator,
	line: unknown,
	opts: ScanOptions
): void {
	for (const candidate of opts.format.texts(line)) {
		if (acc.snippets.length >= SEARCH_SNIPPET_CAP) {
			return;
		}
		const text = buildSnippet(candidate.text, opts.query);
		if (text !== undefined) {
			acc.snippets.push(
				candidate.role === undefined ? { text } : { role: candidate.role, text }
			);
		}
	}
}

/** Folds one raw JSONL line into `acc` — "stop" as soon as the header names
 * a different project (a cwd mismatch drops the whole file). */
function applyLine(
	acc: ScanAccumulator,
	text: string,
	opts: ScanOptions
): "continue" | "stop" {
	let line: unknown;
	try {
		line = JSON.parse(text);
	} catch {
		return "continue"; // malformed / torn line — skip
	}
	if (acc.header === undefined) {
		const found = opts.format.header(line);
		if (found) {
			if (!found.cwd || resolve(found.cwd) !== resolve(opts.dir)) {
				return "stop"; // another project's transcript
			}
			acc.header = found;
		}
	}
	acc.title ??= opts.format.title(line);
	collectSnippets(acc, line, opts);
	return "continue";
}

function finishScan(
	acc: ScanAccumulator,
	file: FileWithMtime
): SessionSearchHit | undefined {
	const { header, snippets, title } = acc;
	if (!(header?.id && header.cwd) || snippets.length === 0) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		cwd: header.cwd,
		id: header.id,
		lastModified: file.mtimeMs,
		snippets,
		title: title ?? header.id,
	};
}

interface FileScanResult {
	hit?: SessionSearchHit;
	timedOut: boolean;
}

interface ScanOptions {
	deadline: number;
	dir: string;
	format: JsonlSearchFormat;
	query: string;
}

/** Streams one transcript incrementally (never a whole-file read — rollout
 * logs run to megabytes); stops early on cwd mismatch or the deadline. Read
 * errors just mean "no hit". */
async function scanJsonlFile(
	file: FileWithMtime,
	opts: ScanOptions
): Promise<FileScanResult> {
	const acc: ScanAccumulator = { snippets: [] };
	const stream = createReadStream(file.path, { encoding: "utf8" });
	const lines = createInterface({
		crlfDelay: Number.POSITIVE_INFINITY,
		input: stream,
	});
	let timedOut = false;
	try {
		for await (const text of lines) {
			if (Date.now() > opts.deadline) {
				timedOut = true;
				break;
			}
			if (applyLine(acc, text, opts) === "stop") {
				break;
			}
		}
	} catch {
		// unreadable / raced deletion — whatever was collected still counts
	} finally {
		lines.close();
		stream.destroy();
	}
	return { hit: finishScan(acc, file), timedOut };
}

/** The generic bounded scan: `files` newest-first (callers pass a
 * `newestFiles` result capped at SEARCH_FILE_CAP), each streamed through
 * `format` until SEARCH_SESSION_CAP sessions match or `deadline` passes. */
export async function searchJsonlTranscripts(opts: {
	deadline: number;
	dir: string;
	files: FileWithMtime[];
	format: JsonlSearchFormat;
	query: string;
}): Promise<SessionSearchOutcome> {
	const { deadline, dir, files, format, query } = opts;
	const scanOptions: ScanOptions = { deadline, dir, format, query };
	const results: SessionSearchHit[] = [];
	let partial = false;
	for (const file of files) {
		if (results.length >= SEARCH_SESSION_CAP) {
			break;
		}
		if (Date.now() > deadline) {
			partial = true;
			break;
		}
		// Sequential on purpose — the deadline is the real bound, and parallel
		// streams would just thrash the box (see collectFilesInto's precedent).
		const scanned = await scanJsonlFile(file, scanOptions);
		partial = partial || scanned.timedOut;
		if (scanned.hit) {
			results.push(scanned.hit);
		}
	}
	return { partial, results };
}
