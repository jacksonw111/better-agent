// A-share trading calendar, derived from the Shanghai Composite (sh000001)
// daily kline rather than a dedicated calendar upstream — every bar date IS a
// trading day, so the latest bar is the last completed trading day and any
// date present in the series is a trading day. Zero new upstream dependency:
// reuses the Tencent fqkline endpoint + parser already used by core/tencent.
// Forward (future) calendar is intentionally out of scope here — see the
// integration plan (Phase 2).
import { fetchWithRetry } from "../http";
import { parseKline } from "../tencent/kline";

const KLINE_HOST = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const SH_COMPOSITE = "sh000001";
// ~40 trading days ≈ two calendar months of history — enough for "last trade
// day", "is today open", and short recent-window lookups.
const LOOKBACK = 40;

export interface TradeCalendar {
	/** Whether the Shanghai session's latest bar is dated today (Asia/Shanghai). */
	isTodayTradingDay: boolean;
	/** Most recent completed A-share trading day, `YYYY-MM-DD`. */
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

// Current calendar date in Asia/Shanghai as `YYYY-MM-DD` (en-CA yields ISO).
export function shanghaiToday(now: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
}

export function parseTradeCalendar(
	json: unknown,
	today: string
): TradeCalendar | null {
	const candles = parseKline(json, SH_COMPOSITE, "day");
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

export async function getTradeCalendar(
	opts: Opts = {}
): Promise<TradeCalendar | null> {
	const url = `${KLINE_HOST}?param=${SH_COMPOSITE},day,,,${LOOKBACK},qfq`;
	try {
		const res = await fetchWithRetry(url, undefined, {
			fetchImpl: opts.fetchImpl,
			signal: opts.signal,
		});
		if (!res.ok) {
			return null;
		}
		return parseTradeCalendar(await res.json(), opts.today ?? shanghaiToday());
	} catch {
		return null;
	}
}
