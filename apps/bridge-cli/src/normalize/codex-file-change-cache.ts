// R3-T2: codex's fileChange approval REQUEST
// (`item/fileChange/requestApproval`) carries only the pending item's id —
// the change list itself (which paths, added/modified/deleted) arrives
// earlier, on the `item/started` notification for the SAME item id
// (hermes-verified pattern, `codex_app_server_session.py:925`: the server
// caches the pending item and renders a "N files, X added, Y modified…"
// summary from it before the approval decision comes back). This mirrors
// that cache: `codex.ts`'s `createCodexNormalizer` records every fileChange
// `item/started` here, keyed by item id; `codex-approvals.ts`'s
// `normalizeCodexApprovalRequest` looks the summary back up when the
// matching `requestApproval` request arrives.
//
// Built on the same bounded cache `tool-timing.ts` uses so a fileChange item
// whose approval request never arrives (a stale id, a protocol drift) can't
// leak memory forever.

import { createBoundedCache } from "./bounded-cache";
import { asString, isRecord } from "./types";

/** How many changed paths `formatSummary` lists by name before collapsing
 * the rest into a trailing "…" — enough to be useful without turning the
 * approval card into a full file listing. */
const MAX_SUMMARY_PATHS = 3;

interface FileChangeCounts {
	added: number;
	deleted: number;
	modified: number;
	paths: string[];
}

const EMPTY_COUNTS: FileChangeCounts = {
	added: 0,
	deleted: 0,
	modified: 0,
	paths: [],
};

/** Tallies one item's `changes[]` entries into added/modified/deleted counts
 * plus the ordered list of paths — mirrors `codex.ts`'s
 * `normalizeCodexFileChangeItem`'s own created/deleted/else-modified mapping
 * so the two stay in sync. Non-conforming entries (no string `path`) are
 * skipped rather than thrown on, same tolerance the rest of the codex
 * normalizer uses for an unconfirmed wire shape. */
function countFileChanges(changes: unknown[]): FileChangeCounts {
	const counts: FileChangeCounts = { ...EMPTY_COUNTS, paths: [] };
	for (const entry of changes) {
		if (!(isRecord(entry) && typeof entry.path === "string")) {
			continue;
		}
		counts.paths.push(entry.path);
		if (entry.kind === "created") {
			counts.added += 1;
		} else if (entry.kind === "deleted") {
			counts.deleted += 1;
		} else {
			counts.modified += 1;
		}
	}
	return counts;
}

function formatSummary(counts: FileChangeCounts): string {
	const total = counts.added + counts.modified + counts.deleted;
	const parts = [
		counts.added > 0 ? `${counts.added} added` : undefined,
		counts.modified > 0 ? `${counts.modified} modified` : undefined,
		counts.deleted > 0 ? `${counts.deleted} deleted` : undefined,
	].filter((part): part is string => part !== undefined);
	const shownPaths = counts.paths.slice(0, MAX_SUMMARY_PATHS).join(", ");
	const truncated = counts.paths.length > MAX_SUMMARY_PATHS ? ", …" : "";
	const fileWord = total === 1 ? "file" : "files";
	return `${total} ${fileWord}: ${parts.join(", ")} (${shownPaths}${truncated})`;
}

export interface CodexFileChangeCache {
	/** Records `item`'s change summary, keyed by its `id` — a no-op if `item`
	 * has no string `id` or its `changes` isn't an array (an unrecognized
	 * shape degrades to "no summary" rather than throwing). */
	record(item: Record<string, unknown>): void;
	/** The summary `record()` cached for `itemId`, or `undefined` if it was
	 * never recorded (or already evicted — see `bounded-cache.ts`). */
	summaryFor(itemId: string): string | undefined;
}

export function createCodexFileChangeCache(): CodexFileChangeCache {
	const summaries = createBoundedCache<string>();
	return {
		record(item: Record<string, unknown>): void {
			const id = asString(item.id);
			if (id === undefined || !Array.isArray(item.changes)) {
				return;
			}
			summaries.set(id, formatSummary(countFileChanges(item.changes)));
		},
		summaryFor(itemId: string): string | undefined {
			return summaries.get(itemId);
		},
	};
}

/** Feeds `raw` (one parsed line off codex's stdout) into `cache` when it's an
 * `item/started` notification for a `fileChange` item — a no-op for every
 * other shape. Called from `createCodexNormalizer` (`codex.ts`) alongside
 * its existing per-line normalization, purely for this side effect: codex's
 * `item/started` mapping stays terminal-only for rendering (see `codex.ts`'s
 * doc comments on why), this cache is the one thing that DOES read the
 * premature `item/started` payload. */
export function recordCodexFileChangeStart(
	cache: CodexFileChangeCache,
	raw: unknown
): void {
	if (!isRecord(raw) || raw.method !== "item/started") {
		return;
	}
	const params = raw.params;
	if (!(isRecord(params) && isRecord(params.item))) {
		return;
	}
	if (params.item.type === "fileChange") {
		cache.record(params.item);
	}
}
