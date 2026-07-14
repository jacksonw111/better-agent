// 财联社电报 (Cailianshe telegraph — realtime CN market flash news) via the
// v1 roll API. The endpoint enforces a `sign` computed purely locally, no
// key needed: sign = md5(sha1(query string with keys sorted alphabetically)).
// Verified live 2026-07 (errno=0).
import { fetchWithRetry } from "../http";
import { md5Hex } from "./md5";

const ROLL_URL = "https://www.cls.cn/v1/roll/get_roll_list";
const CLS_REFERER = "https://www.cls.cn/";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const HOURS_UTC8 = 8;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;
const TIME_PAD = 2;
const HEX_BYTE_PAD = 2;

export interface ClsNewsItem {
	content: string;
	time: string;
	title: string;
}

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface RollItem {
	brief?: string | null;
	content?: string | null;
	ctime?: number | null;
	title?: string | null;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

async function sha1Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(input)
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(HEX_BYTE_PAD, "0"))
		.join("");
}

// ctime is unix seconds — shift to UTC+8 manually and read UTC components
// (Workers has no CN timezone database).
function toUtc8DateTime(ctime: number | null | undefined): string {
	if (typeof ctime !== "number" || !Number.isFinite(ctime)) {
		return "";
	}
	const d = new Date((ctime + HOURS_UTC8 * SECONDS_PER_HOUR) * MS_PER_SECOND);
	const pad = (n: number) => String(n).padStart(TIME_PAD, "0");
	const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
	return `${date} ${time}`;
}

function toItem(item: RollItem): ClsNewsItem {
	const brief = item.brief ?? "";
	return {
		title: item.title || brief,
		content: item.content || brief,
		time: toUtc8DateTime(item.ctime),
	};
}

export async function getClsTelegraph(
	limit: number = DEFAULT_LIMIT,
	opts: FetchOpts = {}
): Promise<ClsNewsItem[]> {
	const params: Record<string, string> = {
		appName: "CailianpressWeb",
		os: "web",
		sv: "7.7.5",
		last_time: "",
		refresh_type: "1",
		rn: String(clampLimit(limit)),
	};
	// Sign recipe: keys sorted alphabetically, joined as k=v with "&", then
	// md5(sha1(qs)) — both hex, computed locally with no key material.
	const qs = Object.keys(params)
		.sort()
		.map((k) => `${k}=${params[k]}`)
		.join("&");
	try {
		const sign = md5Hex(await sha1Hex(qs));
		const res = await fetchWithRetry(
			`${ROLL_URL}?${qs}&sign=${sign}`,
			{ headers: { Referer: CLS_REFERER } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: { roll_data?: RollItem[] | null } | null;
		};
		return (json.data?.roll_data ?? []).map(toItem);
	} catch {
		return [];
	}
}
