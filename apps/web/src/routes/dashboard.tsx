import { createFileRoute } from "@tanstack/react-router";
import { BarChart2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { CloudAgentUsage } from "@/components/dashboard/cloud-agent-usage";
import {
	DEFAULT_WINDOW,
	type WindowDays,
} from "@/components/dashboard/dashboard-constants";
import { LiveSessions } from "@/components/dashboard/live-sessions";
import { StatsPanel } from "@/components/dashboard/stats-panel";
import { UsageOverview } from "@/components/dashboard/usage-overview";
import { useUsageData } from "@/components/dashboard/use-usage-data";
import { WindowToggle } from "@/components/dashboard/window-toggle";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";

// Lazy so recharts (~124KB gzip) stays out of the dashboard route's initial
// chunk — it loads only once the usage chart is actually shown.
const TokenChart = lazy(() =>
	import("@/components/dashboard/token-chart").then((m) => ({
		default: m.TokenChart,
	}))
);

export const Route = createFileRoute("/dashboard")({
	component: DashboardPage,
});

function todayLabel(): string {
	return new Date().toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
	});
}

function DashboardHeader({
	windowDays,
	onWindowChange,
}: {
	windowDays: WindowDays;
	onWindowChange: (w: WindowDays) => void;
}) {
	return (
		<div className="flex items-center justify-between">
			<div className="flex flex-col">
				<h1 className="font-semibold text-lg">Token Tracking</h1>
				<p className="text-muted-foreground text-sm">{todayLabel()}</p>
			</div>
			<WindowToggle onChange={onWindowChange} value={windowDays} />
		</div>
	);
}

function DashboardBody({
	daily,
	isEmpty,
	isPending,
	totals,
	windowDays,
}: {
	daily: ReturnType<typeof useUsageData>["daily"];
	isEmpty: boolean;
	isPending: boolean;
	totals: ReturnType<typeof useUsageData>["totals"];
	windowDays: WindowDays;
}) {
	// Only the chat stats/chart fall back to EmptyState when the (short) chat
	// window has no data — the 180-day activity heatmap and the Local Agents
	// breakdown have their own data sources and must always render, or a user
	// with no recent chat would see nothing at all.
	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<div className="flex flex-col gap-4 lg:col-span-2">
				{isEmpty ? (
					<EmptyState
						body="Start chatting to see your token consumption here."
						icon={BarChart2}
						title="No usage yet"
					/>
				) : (
					<>
						<StatsPanel isPending={isPending} totals={totals} />
						<Suspense
							fallback={
								<div className="h-80 w-full animate-pulse rounded-xl bg-muted/40" />
							}
						>
							<TokenChart daily={daily} isPending={isPending} />
						</Suspense>
					</>
				)}
				<ActivityHeatmap />
			</div>
			<div className="flex flex-col gap-4 lg:col-span-1">
				<LiveSessions />
				<UsageOverview windowDays={windowDays} />
				<CloudAgentUsage windowDays={windowDays} />
			</div>
		</div>
	);
}

export function DashboardPage() {
	const [windowDays, setWindowDays] = useState<WindowDays>(DEFAULT_WINDOW);
	const { isPending, isError, error, daily, totals, isEmpty } =
		useUsageData(windowDays);

	useEffect(() => {
		if (isError) {
			const message =
				error instanceof Error ? error.message : "Failed to load usage";
			toast.error(message);
		}
	}, [isError, error]);

	return (
		<PageContainer>
			<DashboardHeader onWindowChange={setWindowDays} windowDays={windowDays} />
			<DashboardBody
				daily={daily}
				isEmpty={isEmpty}
				isPending={isPending}
				totals={totals}
				windowDays={windowDays}
			/>
		</PageContainer>
	);
}
