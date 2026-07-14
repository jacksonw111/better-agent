import { describe, expect, it } from "vitest";
import { getClsTelegraph } from "./telegraph";

// Precomputed for rn=20: qs (sorted keys) =
// "appName=CailianpressWeb&last_time=&os=web&refresh_type=1&rn=20&sv=7.7.5"
// sha1(qs) = fd2002762f09f170f4067590cc0e83eb2aabc00f
// md5(sha1) = d89fdd16805945016e0b9cb12e994a46
const EXPECTED_SIGN_RN20 = "d89fdd16805945016e0b9cb12e994a46";
const EXPECTED_QS_RN20 =
	"appName=CailianpressWeb&last_time=&os=web&refresh_type=1&rn=20&sv=7.7.5";

// 1720000000s == 2024-07-03 17:46:40 UTC+8.
const CTIME = 1_720_000_000;

const ROLL_PAYLOAD = {
	data: {
		roll_data: [
			{ title: "央行公告", content: "详情内容", ctime: CTIME },
			{ title: "", content: "", brief: "简讯", ctime: CTIME },
		],
	},
};

function fetchImplFor(sink: { url?: string }): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		sink.url = String(url);
		expect(init?.headers).toMatchObject({ Referer: "https://www.cls.cn/" });
		return Promise.resolve(Response.json(ROLL_PAYLOAD));
	}) as typeof fetch;
}

describe("getClsTelegraph: sign recipe", () => {
	it("sends the sorted qs plus sign=md5(sha1(qs)) for rn=20", async () => {
		const sink: { url?: string } = {};
		await getClsTelegraph(20, { fetchImpl: fetchImplFor(sink) });
		const url = new URL(sink.url ?? "");
		expect(url.origin + url.pathname).toBe(
			"https://www.cls.cn/v1/roll/get_roll_list"
		);
		expect(sink.url).toContain(`?${EXPECTED_QS_RN20}&sign=`);
		expect(url.searchParams.get("sign")).toBe(EXPECTED_SIGN_RN20);
	});

	it("clamps the limit into rn (default 20, max 100)", async () => {
		const sink: { url?: string } = {};
		await getClsTelegraph(500, { fetchImpl: fetchImplFor(sink) });
		expect(new URL(sink.url ?? "").searchParams.get("rn")).toBe("100");
		await getClsTelegraph(0, { fetchImpl: fetchImplFor(sink) });
		expect(new URL(sink.url ?? "").searchParams.get("rn")).toBe("20");
	});
});

describe("getClsTelegraph: row mapping", () => {
	it("maps roll_data with UTC+8 timestamps and brief fallback", async () => {
		const rows = await getClsTelegraph(20, { fetchImpl: fetchImplFor({}) });
		expect(rows).toEqual([
			{ title: "央行公告", content: "详情内容", time: "2024-07-03 17:46:40" },
			{ title: "简讯", content: "简讯", time: "2024-07-03 17:46:40" },
		]);
	});
});

describe("getClsTelegraph: degradation", () => {
	it("degrades to [] on HTTP failure", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("x", { status: 404 }))) as typeof fetch;
		expect(await getClsTelegraph(20, { fetchImpl })).toEqual([]);
	});

	it("degrades to [] on malformed JSON", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("not json"))) as typeof fetch;
		expect(await getClsTelegraph(20, { fetchImpl })).toEqual([]);
	});
});
