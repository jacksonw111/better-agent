import type { Context, Hono } from "hono";
import { withUserCache } from "./core/cache";
import type { ToolEnv } from "./core/types";
import { NotConfiguredError, wereadCall } from "./core/weread-client";

function envKey(c: Context): string {
	const auth = c.req.header("authorization");
	const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
	const key =
		(bearer && bearer.length > 0
			? bearer
			: (c.env as ToolEnv | undefined)?.WEREAD_API_KEY) ?? "";
	if (!key) {
		throw new NotConfiguredError();
	}
	return key;
}

async function api(
	c: Context,
	cacheKey: string,
	ttl: number,
	apiName: string,
	params: Record<string, unknown>
) {
	const apiKey = envKey(c);
	return await withUserCache(apiKey, cacheKey, ttl, () =>
		wereadCall(apiKey, apiName, params)
	);
}

function num(c: Context, key: string): number | undefined {
	const v = c.req.query(key);
	return v && v.length > 0 ? Number(v) : undefined;
}

function opt(c: Context, key: string): string | undefined {
	const v = c.req.query(key);
	return v && v.length > 0 ? v : undefined;
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

async function searchHandler(c: Context) {
	const keyword = c.req.query("keyword") ?? "";
	const params = dropUndefined({
		keyword,
		scope: num(c, "scope"),
		maxIdx: num(c, "maxIdx"),
		count: num(c, "count"),
	});
	return c.json(
		await api(
			c,
			`search:${keyword}:${params.scope ?? 0}:${params.maxIdx ?? 0}:${params.count ?? ""}`,
			300,
			"/store/search",
			params
		)
	);
}

async function bookInfoHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	return c.json(
		await api(c, `book:${bookId}`, 86_400, "/book/info", { bookId })
	);
}

async function chaptersHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	return c.json(
		await api(c, `chapters:${bookId}`, 86_400, "/book/chapterinfo", { bookId })
	);
}

async function progressHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	return c.json(
		await api(c, `progress:${bookId}`, 30, "/book/getprogress", { bookId })
	);
}

async function shelfHandler(c: Context) {
	return c.json(await api(c, "shelf", 60, "/shelf/sync", {}));
}

async function notebooksHandler(c: Context) {
	const params = dropUndefined({
		count: num(c, "count"),
		lastSort: num(c, "lastSort"),
	});
	return c.json(
		await api(
			c,
			`notebooks:${params.count ?? 20}:${params.lastSort ?? 0}`,
			60,
			"/user/notebooks",
			params
		)
	);
}

async function bookmarksHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	return c.json(
		await api(c, `bookmarks:${bookId}`, 60, "/book/bookmarklist", { bookId })
	);
}

async function myReviewsHandler(c: Context) {
	const bookid = c.req.query("bookid") ?? "";
	const params = dropUndefined({
		bookid,
		count: num(c, "count"),
		synckey: num(c, "synckey"),
	});
	return c.json(
		await api(
			c,
			`myreviews:${bookid}:${params.synckey ?? 0}:${params.count ?? 20}`,
			60,
			"/review/list/mine",
			params
		)
	);
}

async function bestBookmarksHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	const params = dropUndefined({
		bookId,
		chapterUid: num(c, "chapterUid"),
		synckey: num(c, "synckey"),
	});
	return c.json(
		await api(
			c,
			`best:${bookId}:${params.chapterUid ?? 0}`,
			3600,
			"/book/bestbookmarks",
			params
		)
	);
}

async function underlinesHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	const chapterUid = Number(c.req.query("chapterUid") ?? "") || 0;
	const params = dropUndefined({
		bookId,
		chapterUid,
		synckey: num(c, "synckey"),
	});
	return c.json(
		await api(
			c,
			`underlines:${bookId}:${chapterUid}`,
			3600,
			"/book/underlines",
			params
		)
	);
}

async function publicReviewsHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	const params = dropUndefined({
		bookId,
		reviewListType: num(c, "reviewListType"),
		count: num(c, "count"),
		maxIdx: num(c, "maxIdx"),
		synckey: num(c, "synckey"),
	});
	return c.json(
		await api(
			c,
			`pubreviews:${bookId}:${params.reviewListType ?? 0}:${params.maxIdx ?? 0}`,
			300,
			"/review/list",
			params
		)
	);
}

async function recommendHandler(c: Context) {
	const params = dropUndefined({
		count: num(c, "count"),
		maxIdx: num(c, "maxIdx"),
	});
	return c.json(
		await api(
			c,
			`recommend:${params.maxIdx ?? 0}:${params.count ?? 12}`,
			300,
			"/book/recommend",
			params
		)
	);
}

async function similarHandler(c: Context) {
	const bookId = c.req.query("bookId") ?? "";
	const count = Number(c.req.query("count") ?? "12") || 12;
	const maxIdx = Number(c.req.query("maxIdx") ?? "0") || 0;
	const params = dropUndefined({
		bookId,
		count,
		maxIdx,
		sessionId: opt(c, "sessionId"),
	});
	return c.json(
		await api(
			c,
			`similar:${bookId}:${maxIdx}:${count}`,
			3600,
			"/book/similar",
			params
		)
	);
}

async function readdataHandler(c: Context) {
	const params = dropUndefined({
		mode: opt(c, "mode"),
		baseTime: num(c, "baseTime"),
	});
	return c.json(
		await api(
			c,
			`readdata:${params.mode ?? "monthly"}:${params.baseTime ?? 0}`,
			120,
			"/readdata/detail",
			params
		)
	);
}

async function reviewDetailHandler(c: Context) {
	const reviewId = c.req.query("reviewId") ?? "";
	const params = dropUndefined({
		reviewId,
		commentsCount: num(c, "commentsCount"),
		synckey: num(c, "synckey"),
	});
	return c.json(
		await api(c, `review:${reviewId}`, 60, "/review/single", params)
	);
}

async function discoverFriendsHandler(c: Context) {
	const params = dropUndefined({
		count: num(c, "count"),
		maxIdx: num(c, "maxIdx"),
		synckey: num(c, "synckey"),
	});
	return c.json(
		await api(
			c,
			`discover:${params.maxIdx ?? 0}:${params.count ?? 20}`,
			300,
			"/discover/interact/type3",
			params
		)
	);
}

export function registerRest(app: Hono): void {
	app.get("/api/search", searchHandler);
	app.get("/api/book/info", bookInfoHandler);
	app.get("/api/book/chapters", chaptersHandler);
	app.get("/api/book/progress", progressHandler);
	app.get("/api/shelf", shelfHandler);
	app.get("/api/notebooks", notebooksHandler);
	app.get("/api/bookmarks", bookmarksHandler);
	app.get("/api/my-reviews", myReviewsHandler);
	app.get("/api/best-bookmarks", bestBookmarksHandler);
	app.get("/api/underlines", underlinesHandler);
	app.get("/api/public-reviews", publicReviewsHandler);
	app.get("/api/recommend", recommendHandler);
	app.get("/api/similar", similarHandler);
	app.get("/api/readdata", readdataHandler);
	app.get("/api/review", reviewDetailHandler);
	app.get("/api/discover/friends", discoverFriendsHandler);
}
