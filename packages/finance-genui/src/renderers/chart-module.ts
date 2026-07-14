// Shared lazy loader for the lightweight-charts chunk (~60KB gzip). Memoized so
// it downloads at most once. Exposed separately from CandlestickChart so a
// finance card can warm it during idle time — then opening a kline chart
// renders instantly instead of waiting on the chunk download.
// SSR-safe: only ever called from client-mounted components/effects.
type ChartModule = typeof import("lightweight-charts");

let chartModulePromise: Promise<ChartModule> | null = null;

export function loadChartModule(): Promise<ChartModule> {
	if (chartModulePromise === null) {
		chartModulePromise = import("lightweight-charts");
	}
	return chartModulePromise;
}
