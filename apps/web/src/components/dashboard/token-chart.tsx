import { Skeleton } from "@better-agent/ui/components/skeleton";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	CENTS_PER_DOLLAR,
	COLOR_COST,
	COLOR_INPUT,
	COLOR_OUTPUT,
} from "./dashboard-constants";
import type { DayPoint } from "./use-usage-data";

const skelKey = (i: number) => `sk${i}`;

const CHART_HEIGHT = 280;
const TICK_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const AREA_FILL_OPACITY = 0.15;

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

const formatCostTick = (value: number) => `$${value.toFixed(0)}`;
const formatTokenTick = (value: number) =>
	value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value);

interface TokenChartProps {
	daily: DayPoint[];
	isPending: boolean;
}

interface ChartRow {
	Cost: number;
	day: string;
	Input: number;
	Output: number;
}

function formatDay(day: string): string {
	const d = new Date(`${day}T00:00:00`);
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartSkeleton() {
	return (
		<div className="flex h-72 w-full items-end gap-2 px-2">
			{Array.from({ length: 12 }, (_, i) => (
				<Skeleton
					className="flex-1 rounded-t"
					key={skelKey(i)}
					style={{ height: `${30 + ((i * 37) % 60)}%` }}
				/>
			))}
		</div>
	);
}

function ChartSeries() {
	return (
		<>
			<Area
				dataKey="Input"
				fill={COLOR_INPUT}
				fillOpacity={AREA_FILL_OPACITY}
				name="Input"
				stackId="tokens"
				stroke={COLOR_INPUT}
				strokeWidth={LINE_STROKE_WIDTH}
				type="monotone"
				yAxisId="tokens"
			/>
			<Area
				dataKey="Output"
				fill={COLOR_OUTPUT}
				fillOpacity={AREA_FILL_OPACITY}
				name="Output"
				stackId="tokens"
				stroke={COLOR_OUTPUT}
				strokeWidth={LINE_STROKE_WIDTH}
				type="monotone"
				yAxisId="tokens"
			/>
			<Line
				dataKey="Cost"
				dot={false}
				name="Cost ($)"
				stroke={COLOR_COST}
				strokeWidth={LINE_STROKE_WIDTH}
				type="monotone"
				yAxisId="cost"
			/>
		</>
	);
}

function ChartBody({ data }: { data: ChartRow[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
				<defs>
					<linearGradient id="gInput" x1="0" x2="0" y1="0" y2="1">
						<stop offset="5%" stopColor={COLOR_INPUT} stopOpacity={0.3} />
						<stop offset="95%" stopColor={COLOR_INPUT} stopOpacity={0} />
					</linearGradient>
					<linearGradient id="gOutput" x1="0" x2="0" y1="0" y2="1">
						<stop offset="5%" stopColor={COLOR_OUTPUT} stopOpacity={0.3} />
						<stop offset="95%" stopColor={COLOR_OUTPUT} stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
				<XAxis
					dataKey="day"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
				/>
				<YAxis
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatTokenTick}
					yAxisId="tokens"
				/>
				<YAxis
					orientation="right"
					stroke={COLOR_COST}
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatCostTick}
					yAxisId="cost"
				/>
				<Tooltip contentStyle={TOOLTIP_STYLE} />
				<Legend wrapperStyle={{ fontSize: "11px" }} />
				<ChartSeries />
			</AreaChart>
		</ResponsiveContainer>
	);
}

export function TokenChart({ daily, isPending }: TokenChartProps) {
	if (isPending) {
		return <ChartSkeleton />;
	}
	const data = daily.map((d) => ({
		Cost: d.costCents / CENTS_PER_DOLLAR,
		Input: d.inputTokens,
		Output: d.outputTokens,
		day: formatDay(d.day),
	}));
	return (
		<div className="rounded-xl border bg-card p-4 shadow-sm">
			<p className="mb-3 font-medium text-sm">Usage Trends</p>
			<ChartBody data={data} />
		</div>
	);
}
