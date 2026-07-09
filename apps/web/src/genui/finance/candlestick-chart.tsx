"use client";

import type {
	CandlestickData,
	HistogramData,
	IChartApi,
	ISeriesApi,
	Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { loadChartModule } from "./chart-module";
import type { CandleData } from "./finance-schemas";
import { CardShell } from "./primitives";

// 红涨绿跌 (Chinese convention): rising candles red, falling candles green.
const UP_COLOR = "#ef4444";
const DOWN_COLOR = "#16a34a";
const UP_VOLUME_COLOR = "rgba(239, 68, 68, 0.5)";
const DOWN_VOLUME_COLOR = "rgba(22, 163, 74, 0.5)";
const GRID_COLOR = "rgba(127, 127, 127, 0.12)";
const TEXT_COLOR = "#8b8b8b";
const CHART_HEIGHT = 340;
const VOLUME_PRICE_SCALE_ID = "volume";
const VOLUME_TOP_MARGIN = 0.8;
const VOLUME_BOTTOM_MARGIN = 0;

function toCandlestickData(candles: CandleData[]): CandlestickData<Time>[] {
	return candles.map((c) => ({
		time: c.time as Time,
		open: c.open,
		high: c.high,
		low: c.low,
		close: c.close,
	}));
}

function toVolumeData(candles: CandleData[]): HistogramData<Time>[] {
	return candles.map((c) => ({
		color: c.close >= c.open ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
		time: c.time as Time,
		value: c.volume,
	}));
}

interface ChartHandles {
	candleSeries: ISeriesApi<"Candlestick">;
	chart: IChartApi;
	volumeSeries: ISeriesApi<"Histogram">;
}

async function buildChart(container: HTMLDivElement): Promise<ChartHandles> {
	const { createChart, CandlestickSeries, HistogramSeries, ColorType } =
		await loadChartModule();
	const chart = createChart(container, {
		height: CHART_HEIGHT,
		width: container.clientWidth,
		layout: {
			background: { type: ColorType.Solid, color: "transparent" },
			textColor: TEXT_COLOR,
			attributionLogo: false,
		},
		grid: {
			vertLines: { color: GRID_COLOR },
			horzLines: { color: GRID_COLOR },
		},
		rightPriceScale: { borderColor: GRID_COLOR },
		timeScale: { borderColor: GRID_COLOR, rightOffset: 4 },
		crosshair: { mode: 0 },
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
		color: UP_VOLUME_COLOR,
		priceFormat: { type: "volume" },
		priceScaleId: VOLUME_PRICE_SCALE_ID,
	});
	chart.priceScale(VOLUME_PRICE_SCALE_ID).applyOptions({
		scaleMargins: { bottom: VOLUME_BOTTOM_MARGIN, top: VOLUME_TOP_MARGIN },
	});
	return { candleSeries, chart, volumeSeries };
}

function ChartCanvas({ candles }: { candles: CandleData[] }) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
	// Flips true once the chart is built (async). Drives the data effect so the
	// first candles render as soon as the chart is ready, not only after the
	// next candles change.
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		let disposed = false;
		let resizeObserver: ResizeObserver | undefined;

		if (container) {
			buildChart(container).then(({ chart, candleSeries, volumeSeries }) => {
				if (disposed) {
					chart.remove();
					return;
				}
				chartRef.current = chart;
				candleSeriesRef.current = candleSeries;
				volumeSeriesRef.current = volumeSeries;
				resizeObserver = new ResizeObserver((entries) => {
					const width = entries[0]?.contentRect.width;
					if (width) {
						chart.applyOptions({ width });
					}
				});
				resizeObserver.observe(container);
				setReady(true);
			});
		}

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			chartRef.current?.remove();
			chartRef.current = null;
			candleSeriesRef.current = null;
			volumeSeriesRef.current = null;
		};
	}, []);

	useEffect(() => {
		const candleSeries = candleSeriesRef.current;
		const volumeSeries = volumeSeriesRef.current;
		if (!(ready && candleSeries && volumeSeries)) {
			return;
		}
		candleSeries.setData(toCandlestickData(candles));
		volumeSeries.setData(toVolumeData(candles));
		chartRef.current?.timeScale().fitContent();
	}, [candles, ready]);

	return <div className="w-full" ref={containerRef} />;
}

function ChartPlaceholder({ children }: { children: React.ReactNode }) {
	return (
		<div
			className="flex items-center justify-center rounded-xl border bg-card text-muted-foreground text-sm"
			style={{ height: CHART_HEIGHT }}
		>
			{children}
		</div>
	);
}

/** finance_kline → a TradingView-style candlestick + volume chart. Candles
 * come from the tool result (a prop), not a fetch — unlike the ~/stocks
 * reference this component owns no period toggle or data source. */
export function CandlestickChart({ candles }: { candles: CandleData[] }) {
	if (candles.length === 0) {
		return (
			<CardShell title="K线">
				<ChartPlaceholder>暂无 K线数据</ChartPlaceholder>
			</CardShell>
		);
	}
	return (
		<CardShell title="K线">
			<div className="rounded-xl border bg-card p-2">
				<ChartCanvas candles={candles} />
			</div>
		</CardShell>
	);
}
