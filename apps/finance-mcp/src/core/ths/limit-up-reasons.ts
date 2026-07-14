// 同花顺涨停揭秘 (THS limit-up reasons) — enriches the EastMoney pools with
// the limit-up reason/theme, board type (换手板/一字板/T字板), and seal
// quality. VERIFIED live during research. `first_limit_up_time` is a unix
// SECONDS timestamp (not packed HHMMSS); it is formatted as UTC+8 wall-clock
// arithmetically so the output never depends on the host timezone.
import { fetchWithRetry } from "../http";

const POOL_URL = "https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool";
// THS internal field ids — opaque, copied verbatim from the verified request.
const FIELDS =
	"199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004";
const FILTER = "HS,GEM2STAR";
const ORDER_FIELD = "330324";
const ORDER_TYPE = "0";
const DEFAULT_LIMIT = 200;
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CN_UTC_OFFSET_HOURS = 8;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86_400;
const CLOCK_PAD = 2;

interface FetchOpts {
	fetchImpl?: typeof fetch;
	limit?: number;
	signal?: AbortSignal;
}

export interface RawThsInfo {
	change_rate?: number | null;
	code?: string | null;
	first_limit_up_time?: number | string | null;
	high_days?: string | null;
	is_again_limit?: number | null;
	latest?: number | null;
	limit_up_suc_rate?: number | null;
	limit_up_type?: string | null;
	name?: string | null;
	open_num?: number | null;
	order_amount?: number | null;
	reason_type?: string | null;
}

export interface LimitUpReasonRow {
	boardType: string;
	breakTimes: number;
	code: string;
	firstTime: string;
	highDays: string;
	isAgain: number;
	name: string;
	pct: number;
	price: number;
	reason: string;
	sealAmount: number;
	sealRate: number;
}

function num(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pad(value: number): string {
	return String(value).padStart(CLOCK_PAD, "0");
}

// Unix seconds -> "HH:MM:SS" in UTC+8, computed arithmetically (no Date
// locale involvement).
export function formatCnClockTime(unixSeconds: number): string {
	const shifted = unixSeconds + CN_UTC_OFFSET_HOURS * SECONDS_PER_HOUR;
	const daySeconds =
		((shifted % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
	const hours = Math.floor(daySeconds / SECONDS_PER_HOUR);
	const minutes = Math.floor(
		(daySeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
	);
	const seconds = daySeconds % SECONDS_PER_MINUTE;
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function firstTimeOf(raw: RawThsInfo): string {
	const ts = Number(raw.first_limit_up_time);
	if (!Number.isFinite(ts) || ts <= 0) {
		return "";
	}
	return formatCnClockTime(Math.floor(ts));
}

// Pure per-item parse, exported so tests can exercise the field mapping and
// the unix-seconds time formatting without a fetch stub.
export function parseLimitUpReasonItem(raw: RawThsInfo): LimitUpReasonRow {
	return {
		code: raw.code ?? "",
		name: raw.name ?? "",
		price: num(raw.latest),
		pct: num(raw.change_rate),
		reason: raw.reason_type ?? "",
		boardType: raw.limit_up_type ?? "",
		sealRate: num(raw.limit_up_suc_rate),
		breakTimes: num(raw.open_num),
		sealAmount: num(raw.order_amount),
		highDays: raw.high_days ?? "",
		firstTime: firstTimeOf(raw),
		isAgain: num(raw.is_again_limit),
	};
}

function poolUrl(date: string, limit: number): string {
	const params = new URLSearchParams({
		page: "1",
		limit: String(limit),
		field: FIELDS,
		filter: FILTER,
		order_field: ORDER_FIELD,
		order_type: ORDER_TYPE,
		date,
	});
	return `${POOL_URL}?${params.toString()}`;
}

// date = YYYYMMDD (trading day).
export async function getLimitUpReasons(
	date: string,
	opts: FetchOpts = {}
): Promise<LimitUpReasonRow[]> {
	try {
		const res = await fetchWithRetry(
			poolUrl(date, opts.limit ?? DEFAULT_LIMIT),
			{ headers: { "User-Agent": UA } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: { info?: RawThsInfo[] | null } | null;
		};
		const info = json.data?.info ?? [];
		return info.map((raw) => parseLimitUpReasonItem(raw));
	} catch {
		return [];
	}
}
