import { withUserCache } from "./core/cache";
import type { ToolEnv, ToolResult } from "./core/types";

export type { ToolEnv } from "./core/types";

import { NotConfiguredError, wereadCall } from "./core/weread-client";

export function toolText(text: string, isError = false): ToolResult {
	return { content: [{ type: "text", text }], isError };
}

export function toolJson(value: unknown): ToolResult {
	return toolText(JSON.stringify(value));
}

export function argString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

export function argNumber(
	args: Record<string, unknown>,
	key: string,
	fallback: number
): number {
	const value = args[key];
	return typeof value === "number" ? value : fallback;
}

function argOptionalNumber(
	args: Record<string, unknown>,
	key: string
): number | undefined {
	const value = args[key];
	return typeof value === "number" ? value : undefined;
}

function argOptionalString(
	args: Record<string, unknown>,
	key: string
): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveKey(env: ToolEnv): string {
	const key = env.WEREAD_API_KEY ?? "";
	if (!key) {
		throw new NotConfiguredError();
	}
	return key;
}

async function call(
	env: ToolEnv,
	cacheKey: string,
	ttl: number,
	apiName: string,
	params: Record<string, unknown>
): Promise<ToolResult> {
	const apiKey = resolveKey(env);
	const body = await withUserCache(apiKey, cacheKey, ttl, () =>
		wereadCall(apiKey, apiName, params)
	);
	return toolJson(body);
}

function dropUndefined(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) {
			out[k] = v;
		}
	}
	return out;
}

function handleSearch(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const keyword = argString(args, "keyword");
	const params = dropUndefined({
		keyword,
		scope: argOptionalNumber(args, "scope"),
		maxIdx: argOptionalNumber(args, "maxIdx"),
		count: argOptionalNumber(args, "count"),
	});
	return call(
		env,
		`search:${keyword}:${params.scope ?? 0}:${params.maxIdx ?? 0}:${params.count ?? ""}`,
		300,
		"/store/search",
		params
	);
}

function handleBookInfo(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	return call(env, `book:${bookId}`, 86_400, "/book/info", { bookId });
}

function handleBookChapters(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	return call(env, `chapters:${bookId}`, 86_400, "/book/chapterinfo", {
		bookId,
	});
}

function handleBookProgress(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	return call(env, `progress:${bookId}`, 30, "/book/getprogress", { bookId });
}

function handleShelf(
	_args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	return call(env, "shelf", 60, "/shelf/sync", {});
}

function handleNotebooks(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const params = dropUndefined({
		count: argOptionalNumber(args, "count"),
		lastSort: argOptionalNumber(args, "lastSort"),
	});
	return call(
		env,
		`notebooks:${params.count ?? 20}:${params.lastSort ?? 0}`,
		60,
		"/user/notebooks",
		params
	);
}

function handleBookmarks(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	return call(env, `bookmarks:${bookId}`, 60, "/book/bookmarklist", { bookId });
}

function handleMyReviews(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookid = argString(args, "bookid");
	const params = dropUndefined({
		bookid,
		count: argOptionalNumber(args, "count"),
		synckey: argOptionalNumber(args, "synckey"),
	});
	return call(
		env,
		`myreviews:${bookid}:${params.synckey ?? 0}:${params.count ?? 20}`,
		60,
		"/review/list/mine",
		params
	);
}

function handleBestBookmarks(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	const params = dropUndefined({
		bookId,
		chapterUid: argOptionalNumber(args, "chapterUid"),
		synckey: argOptionalNumber(args, "synckey"),
	});
	return call(
		env,
		`best:${bookId}:${params.chapterUid ?? 0}`,
		3600,
		"/book/bestbookmarks",
		params
	);
}

function handleUnderlines(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	const chapterUid = argNumber(args, "chapterUid", 0);
	const params = dropUndefined({
		bookId,
		chapterUid,
		synckey: argOptionalNumber(args, "synckey"),
	});
	return call(
		env,
		`underlines:${bookId}:${chapterUid}`,
		3600,
		"/book/underlines",
		params
	);
}

function handlePublicReviews(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	const params = dropUndefined({
		bookId,
		reviewListType: argOptionalNumber(args, "reviewListType"),
		count: argOptionalNumber(args, "count"),
		maxIdx: argOptionalNumber(args, "maxIdx"),
		synckey: argOptionalNumber(args, "synckey"),
	});
	return call(
		env,
		`pubreviews:${bookId}:${params.reviewListType ?? 0}:${params.maxIdx ?? 0}`,
		300,
		"/review/list",
		params
	);
}

function handleRecommend(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const params = dropUndefined({
		count: argOptionalNumber(args, "count"),
		maxIdx: argOptionalNumber(args, "maxIdx"),
	});
	return call(
		env,
		`recommend:${params.maxIdx ?? 0}:${params.count ?? 12}`,
		300,
		"/book/recommend",
		params
	);
}

function handleSimilar(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const bookId = argString(args, "bookId");
	const count = argNumber(args, "count", 12);
	const maxIdx = argNumber(args, "maxIdx", 0);
	const params = dropUndefined({
		bookId,
		count,
		maxIdx,
		sessionId: argOptionalString(args, "sessionId"),
	});
	return call(
		env,
		`similar:${bookId}:${maxIdx}:${count}`,
		3600,
		"/book/similar",
		params
	);
}

function handleReaddata(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const params = dropUndefined({
		mode: argOptionalString(args, "mode"),
		baseTime: argOptionalNumber(args, "baseTime"),
	});
	return call(
		env,
		`readdata:${params.mode ?? "monthly"}:${params.baseTime ?? 0}`,
		120,
		"/readdata/detail",
		params
	);
}

function handleReviewDetail(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const reviewId = argString(args, "reviewId");
	const params = dropUndefined({
		reviewId,
		commentsCount: argOptionalNumber(args, "commentsCount"),
		synckey: argOptionalNumber(args, "synckey"),
	});
	return call(env, `review:${reviewId}`, 60, "/review/single", params);
}

type ToolHandler = (
	args: Record<string, unknown>,
	env: ToolEnv
) => Promise<ToolResult>;

const HANDLERS: Record<string, ToolHandler> = {
	weread_search: (args, env) => handleSearch(args, env),
	weread_book_info: (args, env) => handleBookInfo(args, env),
	weread_book_chapters: (args, env) => handleBookChapters(args, env),
	weread_book_progress: (args, env) => handleBookProgress(args, env),
	weread_shelf: (args, env) => handleShelf(args, env),
	weread_notebooks: (args, env) => handleNotebooks(args, env),
	weread_bookmarks: (args, env) => handleBookmarks(args, env),
	weread_my_reviews: (args, env) => handleMyReviews(args, env),
	weread_best_bookmarks: (args, env) => handleBestBookmarks(args, env),
	weread_underlines: (args, env) => handleUnderlines(args, env),
	weread_public_reviews: (args, env) => handlePublicReviews(args, env),
	weread_recommend: (args, env) => handleRecommend(args, env),
	weread_similar: (args, env) => handleSimilar(args, env),
	weread_readdata: (args, env) => handleReaddata(args, env),
	weread_review_detail: (args, env) => handleReviewDetail(args, env),
};

export function runTool(
	name: string,
	args: Record<string, unknown>,
	env: ToolEnv = {}
): Promise<ToolResult> {
	const handler = HANDLERS[name];
	if (!handler) {
		return Promise.resolve(toolText(`Unknown tool: ${name}`, true));
	}
	return handler(args, env);
}
