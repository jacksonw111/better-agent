import type { ToolDef } from "./types";

// Past this many deferrable tools, their schemas stop going to the model and
// search_tools becomes the gateway. Below it, behavior is identical to today.
export const DEFER_THRESHOLD = 12;
const SEARCH_TOP_K = 8;
const NAME_WEIGHT = 3;
const MIN_TOKEN_LEN = 2;
// Keep ASCII alphanumerics and CJK ideographs; everything else separates tokens.
// Without the CJK ranges here, Chinese queries tokenize to nothing and can never
// match — the original cause of "No matches" on 中文 searches.
const CJK_RANGES = "\\u3400-\\u9fff\\uf900-\\ufaff";
const TOKEN_SPLIT_RE = new RegExp(`[^a-z0-9${CJK_RANGES}]+`);
const CJK_CHAR_RE = new RegExp(`[${CJK_RANGES}]`);

export const SEARCH_TOOL_NAME = "search_tools";

/** Per-turn deferred binding: register everything, expose only the active set. */
export interface DeferredBinding {
	/** Names the model may currently see; grows as searches surface tools. */
	activeNames(): string[];
	/** All defs to register with the model runtime (includes search_tools). */
	defs: ToolDef[];
}

// CJK text has no spaces, so plain token-overlap would never fire on it. Emit
// unigrams plus adjacent bigrams: unigrams guarantee a hit, while bigrams give
// precise multi-char terms (股票) more weight than incidental single chars (股).
function cjkGrams(run: string): string[] {
	const chars = [...run];
	const grams: string[] = [...chars];
	for (const [i, char] of chars.entries()) {
		const next = chars[i + 1];
		if (next) {
			grams.push(char + next);
		}
	}
	return grams;
}

// A segment may still mix scripts (e.g. "a股", "沪深300"); break it into runs of
// same-script chars so CJK is n-grammed and ASCII stays whole.
function splitScriptRuns(segment: string): string[] {
	const runs: string[] = [];
	let current = "";
	let currentIsCjk: boolean | null = null;
	for (const char of segment) {
		const isCjk = CJK_CHAR_RE.test(char);
		if (currentIsCjk !== null && isCjk !== currentIsCjk) {
			runs.push(current);
			current = "";
		}
		current += char;
		currentIsCjk = isCjk;
	}
	if (current) {
		runs.push(current);
	}
	return runs;
}

function tokenize(text: string): string[] {
	const tokens: string[] = [];
	for (const segment of text.toLowerCase().split(TOKEN_SPLIT_RE)) {
		if (!segment) {
			continue;
		}
		for (const run of splitScriptRuns(segment)) {
			if (CJK_CHAR_RE.test(run)) {
				tokens.push(...cjkGrams(run));
			} else if (run.length >= MIN_TOKEN_LEN) {
				tokens.push(run);
			}
		}
	}
	return tokens;
}

function scoreDef(def: ToolDef, queryTokens: string[]): number {
	const nameTokens = tokenize(def.name);
	const descTokens = tokenize(def.description);
	let score = 0;
	for (const token of queryTokens) {
		if (nameTokens.some((t) => t.includes(token) || token.includes(t))) {
			score += NAME_WEIGHT;
		}
		if (descTokens.includes(token)) {
			score += 1;
		}
	}
	return score;
}

/** Rank deferred defs against a free-text query; only positive scores. */
export function rankTools(defs: ToolDef[], query: string): ToolDef[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) {
		return [];
	}
	return defs
		.map((def) => ({ def, score: scoreDef(def, queryTokens) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.def);
}

export function shouldDefer(defs: ToolDef[]): boolean {
	return defs.filter((def) => def.defer).length > DEFER_THRESHOLD;
}

function firstSentence(text: string): string {
	const period = text.indexOf(". ");
	const head = period >= 0 ? text.slice(0, period + 1) : text;
	const MAX_SUMMARY = 140;
	return head.length > MAX_SUMMARY ? `${head.slice(0, MAX_SUMMARY)}…` : head;
}

/** Accept the queries array (preferred) or a legacy single query string. */
function extractQueries(args: unknown): string[] {
	const shaped = args as { queries?: unknown; query?: unknown };
	const raw = Array.isArray(shaped.queries)
		? shaped.queries
		: [shaped.query].filter((q) => q !== undefined);
	const queries = raw.filter(
		(q): q is string => typeof q === "string" && q.trim().length > 0
	);
	return [...new Set(queries.map((q) => q.trim()))];
}

export function buildSearchTool(
	deferred: ToolDef[],
	active: Set<string>
): ToolDef {
	return {
		name: SEARCH_TOOL_NAME,
		description:
			"Find additional tools. This agent has more tools than are currently " +
			"visible — before saying a capability is missing, search for it here. " +
			"Batch EVERYTHING you need into ONE call via the queries array — " +
			"never issue multiple search calls for the same goal. Matching tools " +
			"become available to call directly on your next step.",
		parameters: {
			type: "object",
			properties: {
				queries: {
					type: "array",
					items: { type: "string" },
					description:
						"One entry per distinct need, e.g. ['send an email', " +
						"'search tweets']. Do not repeat the same query.",
				},
			},
			required: ["queries"],
		},
		execute: (args) => Promise.resolve(runSearch(args, deferred, active)),
	};
}

function runSearch(
	args: unknown,
	deferred: ToolDef[],
	active: Set<string>
): { isError?: boolean; output: string } {
	const queries = extractQueries(args);
	if (queries.length === 0) {
		return { output: "Provide at least one search query.", isError: true };
	}
	const hits = new Map<string, ToolDef>();
	const misses: string[] = [];
	for (const query of queries) {
		const ranked = rankTools(deferred, query).slice(0, SEARCH_TOP_K);
		if (ranked.length === 0) {
			misses.push(query);
		}
		for (const hit of ranked) {
			hits.set(hit.name, hit);
			active.add(hit.name);
		}
	}
	if (hits.size === 0) {
		return {
			output: `No tools matched ${queries.map((q) => `"${q}"`).join(", ")}. Try different keywords.`,
		};
	}
	const lines = [...hits.values()].map(
		(hit) => `- ${hit.name}: ${firstSentence(hit.description)}`
	);
	const missNote =
		misses.length > 0
			? `\nNo matches for: ${misses.map((q) => `"${q}"`).join(", ")}.`
			: "";
	return {
		output: `These tools are now available — call them directly:\n${lines.join("\n")}${missNote}`,
	};
}

/**
 * Split defs into always-visible and deferred: non-defer defs stay active,
 * deferred schemas are withheld until search_tools surfaces them. The active
 * set only grows within a turn.
 */
export function buildDeferredBinding(allDefs: ToolDef[]): DeferredBinding {
	const deferred = allDefs.filter((def) => def.defer);
	const active = new Set(
		allDefs.filter((def) => !def.defer).map((def) => def.name)
	);
	active.add(SEARCH_TOOL_NAME);
	const searchTool = buildSearchTool(deferred, active);
	return {
		defs: [...allDefs, searchTool],
		activeNames: () => [...active],
	};
}
