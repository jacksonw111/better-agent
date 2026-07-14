import { describe, expect, it } from "vitest";
import { getIndustryNews, parseFeed } from "./industry-news";
import { INDUSTRY_SOURCES } from "./sources";

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Channel Title</title>
<link>https://example.com/</link>
<item>
<title><![CDATA[Chip stocks &amp; AI rally]]></title>
<link>https://example.com/a</link>
<pubDate>Mon, 13 Jul 2026 10:30:00 GMT</pubDate>
</item>
<item>
<title>Older &lt;tagged&gt; story</title>
<link>https://example.com/b</link>
<pubDate>Sun, 12 Jul 2026 08:00:00 GMT</pubDate>
</item>
</channel></rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Feed</title>
<entry>
<title>Robot arms ship</title>
<link href="https://example.com/atom-1"/>
<published>2026-07-14T01:15:00Z</published>
</entry>
</feed>`;

const RAW_TIME_XML = `<rss version="2.0"><channel>
<item>
<title>No real date</title>
<link>https://example.com/raw</link>
<pubDate>soon-ish</pubDate>
</item>
</channel></rss>`;

function rssItem(index: number, day: number): string {
	return `<item><title>Story ${index}</title><link>https://example.com/${index}</link><pubDate>2026-07-0${day}T00:00:00Z</pubDate></item>`;
}

const MANY_ITEMS_XML = `<rss version="2.0"><channel>${rssItem(1, 1)}${rssItem(2, 4)}${rssItem(3, 2)}${rssItem(4, 3)}</channel></rss>`;

const SECURITY_SOURCES = INDUSTRY_SOURCES.security ?? [];
const URL_A = SECURITY_SOURCES[0]?.url ?? "";
const URL_B = SECURITY_SOURCES[1]?.url ?? "";
const SOURCE_A = SECURITY_SOURCES[0]?.name ?? "";
const SOURCE_B = SECURITY_SOURCES[1]?.name ?? "";
const HTTP_NOT_FOUND = 404;

// URL -> body map; any URL not in the map returns a 404 (non-retryable so
// the degradation tests stay fast).
function fetchImplFor(bodies: Record<string, string>): typeof fetch {
	return ((url: string | URL | Request) => {
		const body = bodies[String(url)];
		if (body === undefined) {
			return Promise.resolve(
				new Response("not found", { status: HTTP_NOT_FOUND })
			);
		}
		return Promise.resolve(new Response(body));
	}) as typeof fetch;
}

describe("parseFeed: RSS 2.0", () => {
	it("parses items with CDATA titles, entities, and normalized UTC times", () => {
		const items = parseFeed(RSS_XML, "Feed A");
		expect(items).toEqual([
			{
				link: "https://example.com/a",
				source: "Feed A",
				time: "2026-07-13 10:30",
				title: "Chip stocks & AI rally",
			},
			{
				link: "https://example.com/b",
				source: "Feed A",
				time: "2026-07-12 08:00",
				title: "Older <tagged> story",
			},
		]);
	});

	it("keeps an unparseable pubDate verbatim", () => {
		const items = parseFeed(RAW_TIME_XML, "Feed A");
		expect(items).toHaveLength(1);
		expect(items[0]?.time).toBe("soon-ish");
	});
});

describe("parseFeed: Atom", () => {
	it("parses entries with href links and published dates", () => {
		const items = parseFeed(ATOM_XML, "Feed B");
		expect(items).toEqual([
			{
				link: "https://example.com/atom-1",
				source: "Feed B",
				time: "2026-07-14 01:15",
				title: "Robot arms ship",
			},
		]);
	});

	it("returns [] for non-feed input", () => {
		expect(parseFeed("<html>nope</html>", "Feed B")).toEqual([]);
		expect(parseFeed("", "Feed B")).toEqual([]);
	});
});

describe("getIndustryNews: merging and sorting", () => {
	it("merges feeds and sorts newest first across sources", async () => {
		const fetchImpl = fetchImplFor({ [URL_A]: RSS_XML, [URL_B]: ATOM_XML });
		const items = await getIndustryNews("security", 20, { fetchImpl });
		expect(items.map((item) => item.source)).toEqual([
			SOURCE_B,
			SOURCE_A,
			SOURCE_A,
		]);
		expect(items.map((item) => item.time)).toEqual([
			"2026-07-14 01:15",
			"2026-07-13 10:30",
			"2026-07-12 08:00",
		]);
	});

	it("caps each source at 3 items and the merge at limit", async () => {
		const fetchImpl = fetchImplFor({ [URL_A]: MANY_ITEMS_XML });
		const items = await getIndustryNews("security", 20, { fetchImpl });
		expect(items.map((item) => item.title)).toEqual([
			"Story 2",
			"Story 4",
			"Story 3",
		]);
		const limited = await getIndustryNews("security", 2, { fetchImpl });
		expect(limited).toHaveLength(2);
	});
});

describe("getIndustryNews: degradation", () => {
	it("returns [] for an unknown sector without fetching", async () => {
		const fetchImpl = (() => {
			throw new Error("should not fetch");
		}) as typeof fetch;
		expect(await getIndustryNews("crypto", 20, { fetchImpl })).toEqual([]);
	});

	it("survives individual feed failures with the other feeds intact", async () => {
		const fetchImpl = fetchImplFor({ [URL_B]: ATOM_XML });
		const items = await getIndustryNews("security", 20, { fetchImpl });
		expect(items).toEqual([
			{
				link: "https://example.com/atom-1",
				source: SOURCE_B,
				time: "2026-07-14 01:15",
				title: "Robot arms ship",
			},
		]);
	});

	it("returns [] when every feed fails", async () => {
		const fetchImpl = fetchImplFor({});
		expect(await getIndustryNews("security", 20, { fetchImpl })).toEqual([]);
	});
});
