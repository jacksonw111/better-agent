"use client";

import type {
	CandlestickData,
	HistogramData,
	IChartApi,
	ISeriesApi,
	MouseEventParams,
	Time,
} from "lightweight-charts";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { type CandleHoverInfo, CandlestickLegend } from "./candlestick-legend";
import { computeMA, MA_COLORS, MA_CONFIGS } from "./candlestick-ma";
import { loadChartModule } from "./chart-module";
import {
	DEFAULT_CHART_HEIGHT,
	DOWN_COLOR,
	lightweightChartOptions,
	UP_COLOR,
} from "./chart-theme";
import type { CandleData } from "./finance-schemas";

// Phase 2 Task 5 — the lightweight-charts lifecycle for the PriceChart
// archetype (design doc §8.4). Split out of candlestick-chart.tsx (the
// CardShell/ControlStrip orchestrator) to keep both files under the 299-line
// cap; this file owns the async chart build, the candle/volume/MA series,
// the native crosshair → OHLC legend bridge, and the Period range apply.

const VOLUME_PRICE_SCALE_ID = "volume";
const VOLUME_TOP_MARGIN = 0.8;
const VOLUME_BOTTOM_MARGIN = 0;
const VOLUME_ALPHA = 0.5;
const MA_LINE_WIDTH = 2;
const HEX_RGB_LEN = 6;
const HEX_RADIX = 16;
const HEX_BYTE_LEN = 2;
const HEX_R_START = 0;
const HEX_G_START = HEX_R_START + HEX_BYTE_LEN;
const HEX_B_START = HEX_G_START + HEX_BYTE_LEN;
const HEX_B_END = HEX_B_START + HEX_BYTE_LEN;

/** `#rrggbb` → `rgba(r, g, b, alpha)` — the volume histogram's translucent
 * up/down fills derive from the same price-axis hex the candles use instead
 * of a second hardcoded literal (§11 图表 token 单一出口). */
function hexToRgba(hex: string, alpha: number): string {
	const clean = hex.replace("#", "").padEnd(HEX_RGB_LEN, "0");
	const r = Number.parseInt(clean.slice(HEX_R_START, HEX_G_START), HEX_RADIX);
	const g = Number.parseInt(clean.slice(HEX_G_START, HEX_B_START), HEX_RADIX);
	const b = Number.parseInt(clean.slice(HEX_B_START, HEX_B_END), HEX_RADIX);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toCandlestickData(candles: CandleData[]): CandlestickData<Time>[] {
	return candles.map((c) => ({
		close: c.close,
		high: c.high,
		low: c.low,
		open: c.open,
		time: c.time as Time,
	}));
}

function toVolumeData(candles: CandleData[]): HistogramData<Time>[] {
	return candles.map((c) => ({
		color:
			c.close >= c.open
				? hexToRgba(UP_COLOR, VOLUME_ALPHA)
				: hexToRgba(DOWN_COLOR, VOLUME_ALPHA),
		time: c.time as Time,
		value: c.volume,
	}));
}

interface ChartHandles {
	candleSeries: ISeriesApi<"Candlestick">;
	chart: IChartApi;
	maSeriesById: Map<string, ISeriesApi<"Line">>;
	volumeSeries: ISeriesApi<"Histogram">;
}

async function buildChart(container: HTMLDivElement): Promise<ChartHandles> {
	const {
		createChart,
		CandlestickSeries,
		HistogramSeries,
		LineSeries,
		ColorType,
	} = await loadChartModule();
	const chart = createChart(container, {
		// autoSize installs an internal ResizeObserver that measures the
		// container itself — this is what survives a container that starts at
		// clientWidth 0 (built async inside a chat bubble, before layout has
		// run) and grows once the bubble is actually laid out.
		autoSize: true,
		height: DEFAULT_CHART_HEIGHT,
		...lightweightChartOptions(ColorType.Solid),
	});
	const candleSeries = chart.addSeries(CandlestickSeries, {
		borderDownColor: DOWN_COLOR,
		borderUpColor: UP_COLOR,
		downColor: DOWN_COLOR,
		upColor: UP_COLOR,
		wickDownColor: DOWN_COLOR,
		wickUpColor: UP_COLOR,
	});
	const volumeSeries = chart.addSeries(HistogramSeries, {
		color: hexToRgba(UP_COLOR, VOLUME_ALPHA),
		priceFormat: { type: "volume" },
		priceScaleId: VOLUME_PRICE_SCALE_ID,
	});
	chart.priceScale(VOLUME_PRICE_SCALE_ID).applyOptions({
		scaleMargins: { bottom: VOLUME_BOTTOM_MARGIN, top: VOLUME_TOP_MARGIN },
	});
	const maSeriesById = new Map<string, ISeriesApi<"Line">>(
		MA_CONFIGS.map((ma, index) => [
			ma.id,
			chart.addSeries(LineSeries, {
				color: MA_COLORS[index],
				lastValueVisible: false,
				lineWidth: MA_LINE_WIDTH,
				priceLineVisible: false,
				visible: false,
			}),
		])
	);
	return { candleSeries, chart, maSeriesById, volumeSeries };
}

/** Applies the Period range control: a trailing `n`-candle window via
 * `setVisibleLogicalRange`, or the full series via `fitContent` for "全部"
 * (`rangeN === null`, or a window that already covers every candle). Never
 * re-fetches or re-slices the underlying series data — only the visible
 * window changes (§8.4 P, §11 交互只在 payload 内). */
function applyRange(
	chart: IChartApi,
	rangeN: number | null,
	candleCount: number
): void {
	if (rangeN === null || rangeN >= candleCount) {
		chart.timeScale().fitContent();
		return;
	}
	chart.timeScale().setVisibleLogicalRange({
		from: candleCount - rangeN,
		to: candleCount - 1,
	});
}

function readHoverInfo(
	param: MouseEventParams<Time>,
	candleSeries: ISeriesApi<"Candlestick">
): CandleHoverInfo | null {
	if (!param.time) {
		return null;
	}
	const data = param.seriesData.get(candleSeries) as
		| CandlestickData<Time>
		| undefined;
	if (!data) {
		return null;
	}
	return {
		close: data.close,
		high: data.high,
		low: data.low,
		open: data.open,
		time: String(param.time),
	};
}

/** Sets candle/volume/MA series data and applies the current range — the
 * single effect body that runs once the chart is ready and whenever candles
 * or the range selection change. */
function syncChartData(
	handles: ChartHandles,
	candles: CandleData[],
	rangeN: number | null
): void {
	handles.candleSeries.setData(toCandlestickData(candles));
	handles.volumeSeries.setData(toVolumeData(candles));
	for (const ma of MA_CONFIGS) {
		const series = handles.maSeriesById.get(ma.id);
		series?.setData(
			computeMA(candles, ma.period).map((p) => ({
				time: p.time as Time,
				value: p.value,
			}))
		);
	}
	applyRange(handles.chart, rangeN, candles.length);
}

interface ChartLifecycle {
	containerRef: RefObject<HTMLDivElement | null>;
	handlesRef: RefObject<ChartHandles | null>;
	hoverInfo: CandleHoverInfo | null;
	ready: boolean;
}

/** Owns the async build/dispose lifecycle: mounts the chart into
 * `containerRef` once, tears it down on unmount, and bridges the native
 * crosshair to `hoverInfo` for the OHLC legend overlay. Split out of
 * `ChartCanvas` to keep that component under the function-size cap. */
function useChartLifecycle(): ChartLifecycle {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const handlesRef = useRef<ChartHandles | null>(null);
	// Flips true once the chart is built (async) — drives the sync effect so
	// the first candles render as soon as the chart is ready, not only after
	// the next candles/range change.
	const [ready, setReady] = useState(false);
	const [hoverInfo, setHoverInfo] = useState<CandleHoverInfo | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		let disposed = false;

		if (container) {
			buildChart(container).then((handles) => {
				if (disposed) {
					handles.chart.remove();
					return;
				}
				handlesRef.current = handles;
				handles.chart.subscribeCrosshairMove((param) => {
					setHoverInfo(readHoverInfo(param, handles.candleSeries));
				});
				setReady(true);
			});
		}

		return () => {
			disposed = true;
			handlesRef.current?.chart.remove();
			handlesRef.current = null;
		};
	}, []);

	return { containerRef, handlesRef, hoverInfo, ready };
}

/** Applies the Se (MA overlay) toggle whenever the chart is ready or the
 * selection changes — visibility only, never a data re-fetch. */
function useMaVisibility(
	handlesRef: RefObject<ChartHandles | null>,
	ready: boolean,
	maSelected: string[]
): void {
	useEffect(() => {
		const handles = handlesRef.current;
		if (!(ready && handles)) {
			return;
		}
		for (const ma of MA_CONFIGS) {
			handles.maSeriesById
				.get(ma.id)
				?.applyOptions({ visible: maSelected.includes(ma.id) });
		}
	}, [handlesRef, maSelected, ready]);
}

/** The lightweight-charts canvas: candlesticks + volume + toggleable MA
 * overlays, sized via `autoSize` (survives a chat-bubble container that
 * starts at clientWidth 0) and skinned via `chart-theme`'s shared
 * `lightweightChartOptions`. Candles are a prop (already-fetched tool
 * result) — Period/Series only re-view what's already here. */
export function ChartCanvas({
	candles,
	maSelected,
	rangeN,
}: {
	candles: CandleData[];
	maSelected: string[];
	rangeN: number | null;
}) {
	const { containerRef, handlesRef, hoverInfo, ready } = useChartLifecycle();

	useEffect(() => {
		const handles = handlesRef.current;
		if (ready && handles) {
			syncChartData(handles, candles, rangeN);
		}
	}, [candles, handlesRef, ready, rangeN]);

	useMaVisibility(handlesRef, ready, maSelected);

	// Explicit height (not just width:100%) so the container always has a
	// non-zero box for autoSize's ResizeObserver to measure, even before the
	// chat bubble has finished laying out horizontally. `relative` anchors the
	// absolutely-positioned OHLC legend overlay.
	return (
		<div className="relative w-full" style={{ height: DEFAULT_CHART_HEIGHT }}>
			<div className="h-full w-full" ref={containerRef} />
			<CandlestickLegend info={hoverInfo} />
		</div>
	);
}
