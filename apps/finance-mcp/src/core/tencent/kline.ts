import { parseSymbol } from "../symbol";
import type { Candle } from "../types";

export type KlinePeriod = "day" | "week" | "month";

const KLINE_HOST = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";

function num(v: unknown): number {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : 0;
}

// Row: [date, open, close, high, low, volume]
function rowToCandle(row: unknown[]): Candle | null {
	if (row.length < 6) {
		return null;
	}
	const time = String(row[0] ?? "");
	if (!time) {
		return null;
	}
	return {
		time,
		open: num(row[1]),
		close: num(row[2]),
		high: num(row[3]),
		low: num(row[4]),
		volume: num(row[5]),
	};
}

export function parseKline(
	json: unknown,
	tencentCode: string,
	period: KlinePeriod
): Candle[] {
	const data = (json as { data?: Record<string, Record<string, unknown>> })
		.data;
	const node = data?.[tencentCode];
	const rows = node?.[`qfq${period}`] ?? node?.[period];
	if (!Array.isArray(rows)) {
		return [];
	}
	const candles: Candle[] = [];
	for (const row of rows as unknown[][]) {
		const candle = rowToCandle(row);
		if (candle) {
			candles.push(candle);
		}
	}
	return candles;
}

export async function getKline(
	symbol: string,
	period: KlinePeriod,
	limit: number,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<Candle[]> {
	const doFetch = opts.fetchImpl ?? fetch;
	const { tencent } = parseSymbol(symbol);
	const url = `${KLINE_HOST}?param=${tencent},${period},,,${limit},qfq`;
	const res = await doFetch(url, { signal: opts.signal });
	if (!res.ok) {
		throw new Error(`tencent kline HTTP ${res.status}`);
	}
	return parseKline(await res.json(), tencent, period);
}
