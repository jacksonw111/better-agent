// US trading calendar, derived from the S&P 500 (Tencent code us.INX) daily
// kline — same trick as the A-share calendar in core/market/trade-calendar.ts:
// every bar date IS a trading day, so the latest bar is the last completed (or
// in-progress) trading day. Dates are exchange-local (America/New_York).
// Forward (future) calendar is intentionally out of scope.
import { fetchWithRetry } from "../http";
import { parseKline } from "../tencent/kline";

const KLINE_HOST = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const SP500 = "us.INX";
// ~40 trading days ≈ two calendar months of history — enough for "last trade
// day", "is today open", and short recent-window lookups.
const LOOKBACK = 40;

export interface UsTradeCalendar {
	/** Whether the S&P 500's latest bar is dated today (America/New_York). */
	isTodayTradingDay: boolean;
	/** Most recent US trading day with a bar, `YYYY-MM-DD` (ET). */
	lastTradeDate: string;
	/** Recent trading days, ascending, `YYYY-MM-DD` (up to LOOKBACK entries). */
	tradeDays: string[];
}

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	/** Injectable "today" (`YYYY-MM-DD`) for deterministic tests. */
	today?: string;
}

// Current calendar date in America/New_York as `YYYY-MM-DD` (en-CA is ISO).
export function newYorkToday(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

export function parseUsTradeCalendar(
	json: unknown,
	today: string
): UsTradeCalendar | null {
	const candles = parseKline(json, SP500, "day");
	if (candles.length === 0) {
		return null;
	}
	const tradeDays = candles.map((c) => c.time);
	const lastTradeDate = tradeDays.at(-1) ?? "";
	return {
		lastTradeDate,
		isTodayTradingDay: lastTradeDate === today,
		tradeDays,
	};
}

export async function getUsTradeCalendar(
	opts: Opts = {}
): Promise<UsTradeCalendar | null> {
	const url = `${KLINE_HOST}?param=${SP500},day,,,${LOOKBACK},qfq`;
	try {
		const res = await fetchWithRetry(url, undefined, {
			fetchImpl: opts.fetchImpl,
			signal: opts.signal,
		});
		if (!res.ok) {
			return null;
		}
		return parseUsTradeCalendar(await res.json(), opts.today ?? newYorkToday());
	} catch {
		return null;
	}
}
