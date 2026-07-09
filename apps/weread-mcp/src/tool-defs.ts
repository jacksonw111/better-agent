export interface ToolDef {
	description: string;
	inputSchema: Record<string, unknown>;
	name: string;
}

export const TOOLS: ToolDef[] = [];
export const TOOL_NAMES = new Set<string>();

function add(def: ToolDef): void {
	TOOLS.push(def);
	TOOL_NAMES.add(def.name);
}

add({
	name: "weread_search",
	description:
		"Search the WeRead store for books, audiobooks, web novels, authors, " +
		"articles, and book lists. scope selects the result type: 0=all, 10=ebook, " +
		"16=web-novel, 14=audiobook, 6=author, 12=full-text, 13=book-list, " +
		"2=official-account, 4=article. Pick scope from the user's intent; use 0 only " +
		"for an ambiguous 'just search' request.",
	inputSchema: {
		type: "object",
		properties: {
			keyword: { type: "string", description: "Search keyword." },
			scope: {
				type: "number",
				description:
					"0=all, 10=ebook, 16=web-novel, 14=audiobook, 6=author, 12=full-text, 13=book-list, 2=official-account, 4=article.",
			},
			maxIdx: {
				type: "number",
				description: "Pagination offset (last item's searchIdx). Default 0.",
			},
			count: {
				type: "number",
				description: "Page size. Omit to use server default 15.",
			},
		},
		required: ["keyword"],
		additionalProperties: false,
	},
});

add({
	name: "weread_book_info",
	description:
		"Book details: title, author, translator, cover, intro, category, " +
		"publisher, publishTime, isbn, wordCount, rating, ratingCount.",
	inputSchema: {
		type: "object",
		properties: { bookId: { type: "string", description: "Book ID." } },
		required: ["bookId"],
		additionalProperties: false,
	},
});

add({
	name: "weread_book_chapters",
	description:
		"Chapter table of contents for a book: chapterUid, idx, title, wordCount, " +
		"level (1=top heading), price, paid status.",
	inputSchema: {
		type: "object",
		properties: { bookId: { type: "string", description: "Book ID." } },
		required: ["bookId"],
		additionalProperties: false,
	},
});

add({
	name: "weread_book_progress",
	description:
		"Reading progress for a book: progress (0-100 integer percent, NOT a " +
		"fraction — 1 means 1% not 100%), recordReadingTime (seconds), updateTime. " +
		"Only progress=100 with finishTime means finished.",
	inputSchema: {
		type: "object",
		properties: { bookId: { type: "string", description: "Book ID." } },
		required: ["bookId"],
		additionalProperties: false,
	},
});

add({
	name: "weread_shelf",
	description:
		"Bookshelf sync: books[] (ebooks), albums[] (audiobooks), mp (article " +
		"collection entry), archive[] (book lists). Shelf total = books.length + " +
		"albums.length + (mp non-empty ? 1 : 0). Do NOT count ebooks only.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
});

add({
	name: "weread_notebooks",
	description:
		"Notebook overview: books with notes. Per-book note count = reviewCount + " +
		"noteCount + bookmarkCount (noteCount = highlights only, not total). " +
		"Paginate with count + lastSort (the last item's sort), NOT offset/limit.",
	inputSchema: {
		type: "object",
		properties: {
			count: { type: "number", description: "Page size. Default 20." },
			lastSort: {
				type: "number",
				description: "Cursor = previous page's last item sort value.",
			},
		},
		additionalProperties: false,
	},
});

add({
	name: "weread_bookmarks",
	description:
		"Personal highlights (划线) for one book. Filters out bookmarks (type=0), " +
		"returns only highlights (type=1) with markText, chapterUid, createTime.",
	inputSchema: {
		type: "object",
		properties: { bookId: { type: "string", description: "Book ID." } },
		required: ["bookId"],
		additionalProperties: false,
	},
});

add({
	name: "weread_my_reviews",
	description:
		"Personal thoughts/reviews (想法/点评) for one book: highlight thoughts, " +
		"chapter reviews, whole-book reviews. Includes abstract (the highlighted " +
		"source text) and content (the thought).",
	inputSchema: {
		type: "object",
		properties: {
			bookid: { type: "string", description: "Book ID." },
			count: { type: "number", description: "Page size. Default 20." },
			synckey: { type: "number", description: "Pagination cursor. Default 0." },
		},
		required: ["bookid"],
		additionalProperties: false,
	},
});

add({
	name: "weread_best_bookmarks",
	description:
		"Popular highlights (热门划线) for a book or chapter: markText + count " +
		"(how many people highlighted). Server returns top 20, no pagination.",
	inputSchema: {
		type: "object",
		properties: {
			bookId: { type: "string", description: "Book ID." },
			chapterUid: {
				type: "number",
				description: "Chapter UID. 0 or omit = all chapters.",
			},
			synckey: { type: "number", description: "Sync key. Default 0." },
		},
		required: ["bookId"],
		additionalProperties: false,
	},
});

add({
	name: "weread_underlines",
	description:
		"Highlight heat stats for a chapter (X人划线): range, count, score, type. " +
		"Does NOT include highlight text — use weread_best_bookmarks for text.",
	inputSchema: {
		type: "object",
		properties: {
			bookId: { type: "string", description: "Book ID." },
			chapterUid: {
				type: "number",
				description: "Chapter UID (from weread_book_chapters).",
			},
			synckey: { type: "number", description: "Sync key. Default 0." },
		},
		required: ["bookId", "chapterUid"],
		additionalProperties: false,
	},
});

add({
	name: "weread_public_reviews",
	description:
		"Public reviews (公开点评) for a book. reviewListType: 0=all, 1=recommended, " +
		"2=negative, 3=newest, 4=average. star: 20=1★, 40=2★, 60=3★, 80=4★, 100=5★.",
	inputSchema: {
		type: "object",
		properties: {
			bookId: { type: "string", description: "Book ID." },
			reviewListType: {
				type: "number",
				description:
					"0=all, 1=recommended, 2=negative, 3=newest, 4=average. Default 0.",
			},
			count: { type: "number", description: "Page size. Default 20." },
			maxIdx: {
				type: "number",
				description: "Pagination offset (last item's idx). Default 0.",
			},
			synckey: { type: "number", description: "Pagination cursor. Default 0." },
		},
		required: ["bookId"],
		additionalProperties: false,
	},
});

add({
	name: "weread_recommend",
	description:
		"Personalized recommendations (为你推荐), matching the app homepage. Returns " +
		"bookId, title, author, cover, intro, reason, rating.",
	inputSchema: {
		type: "object",
		properties: {
			count: { type: "number", description: "Page size. Default 12." },
			maxIdx: {
				type: "number",
				description: "Pagination offset (last item's searchIdx). Default 0.",
			},
		},
		additionalProperties: false,
	},
});

add({
	name: "weread_similar",
	description:
		"Similar-book recommendations for a given book (相似推荐). count and maxIdx " +
		"are REQUIRED by the upstream — always pass them explicitly.",
	inputSchema: {
		type: "object",
		properties: {
			bookId: { type: "string", description: "Book ID." },
			count: {
				type: "number",
				description: "Page size. Pass 12 for first page.",
			},
			maxIdx: {
				type: "number",
				description: "Pagination offset. Pass 0 for first page.",
			},
			sessionId: {
				type: "string",
				description: "Session ID from previous page (omit on first page).",
			},
		},
		required: ["bookId", "count", "maxIdx"],
		additionalProperties: false,
	},
});

add({
	name: "weread_readdata",
	description:
		"Reading statistics. mode: weekly/monthly/annually/overall (default monthly). " +
		"ALL durations are in SECONDS (totalReadTime, dayAverageReadTime, readTime). " +
		"progress is 0-100 integer. Only fixed natural periods — for arbitrary date " +
		"ranges combine multiple periods.",
	inputSchema: {
		type: "object",
		properties: {
			mode: {
				type: "string",
				enum: ["weekly", "monthly", "annually", "overall"],
				description: "Default monthly.",
			},
			baseTime: {
				type: "number",
				description: "Base timestamp (0=current period). overall always 0.",
			},
		},
		additionalProperties: false,
	},
});

add({
	name: "weread_review_detail",
	description:
		"Single thought/review detail by reviewId, with comments and likes.",
	inputSchema: {
		type: "object",
		properties: {
			reviewId: { type: "string", description: "Review/thought ID." },
			commentsCount: {
				type: "number",
				description: "Comments to fetch. Default 10.",
			},
			synckey: { type: "number", description: "Sync key. Default 0." },
		},
		required: ["reviewId"],
		additionalProperties: false,
	},
});
