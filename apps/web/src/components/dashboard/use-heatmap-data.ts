// apps/web/src/components/dashboard/use-heatmap-data.ts

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { orpc } from "@/utils/orpc";
import {
	buildHeatmapDayAxis,
	HEATMAP_WINDOW_DAYS,
	type HeatmapDayPoint,
	mergeHeatmapDays,
} from "./heatmap-utils";

/**
 * Wide (180-day) daily activity feed for the GitHub-style heatmap.
 *
 * Deliberately decoupled from `useUsageData`'s 3/7/12 `window-toggle` state:
 * it always requests `usage.dailyActivity`'s max window (`HEATMAP_WINDOW_DAYS`)
 * regardless of what the token chart above it is showing, and never reads
 * `usage.summary`.
 */
export function useHeatmapData() {
	const query = useQuery(
		orpc.usage.dailyActivity.queryOptions({
			input: { days: HEATMAP_WINDOW_DAYS },
		})
	);

	const daily: HeatmapDayPoint[] = useMemo(() => {
		const axis = buildHeatmapDayAxis(HEATMAP_WINDOW_DAYS);
		return mergeHeatmapDays(axis, query.data ?? []);
	}, [query.data]);

	return {
		daily,
		error: query.error,
		isError: query.isError,
		isPending: query.isPending,
	};
}
