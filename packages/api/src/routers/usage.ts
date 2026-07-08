import type {
	UsageAggregateRow,
	UsageRecordStore,
} from "@better-agent/db/repositories/usage-record-store";
import type { UsageStore } from "@better-agent/db/repositories/usage-store";
import { z } from "zod";
import { authorizedUserProcedure } from "../index";

const MS_PER_DAY = 86_400_000;

interface Totals {
	costCents: number;
	inputTokens: number;
	outputTokens: number;
	turns: number;
}

const EMPTY_TOTALS: Totals = {
	costCents: 0,
	inputTokens: 0,
	outputTokens: 0,
	turns: 0,
};

export const usageWindowInput = z.object({
	windowDays: z.union([z.literal(3), z.literal(7), z.literal(12)]),
});

/** Daily rows + summed totals for one user over a rolling window. */
export async function summarizeUsage(
	store: UsageStore,
	userId: string,
	windowDays: number
) {
	const since = new Date(Date.now() - windowDays * MS_PER_DAY);
	const daily = await store.dailySummary(userId, since);
	const totals = daily.reduce<Totals>(
		(acc, day) => ({
			costCents: acc.costCents + day.costCents,
			inputTokens: acc.inputTokens + day.inputTokens,
			outputTokens: acc.outputTokens + day.outputTokens,
			turns: acc.turns + day.turns,
		}),
		EMPTY_TOTALS
	);
	return { windowDays, daily, totals };
}

const EMPTY_AGGREGATE_TOTALS: Omit<UsageAggregateRow, "key"> = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	reasoningTokens: 0,
	costUsd: 0,
	unpricedCount: 0,
	count: 0,
};

export const usageAggregateInput = z.object({
	range: z.object({ from: z.coerce.date(), to: z.coerce.date() }),
	groupBy: z.enum(["day", "model", "agent", "session", "source"]),
});

function sumAggregateTotals(
	groups: UsageAggregateRow[]
): Omit<UsageAggregateRow, "key"> {
	return groups.reduce<Omit<UsageAggregateRow, "key">>(
		(acc, group) => ({
			inputTokens: acc.inputTokens + group.inputTokens,
			outputTokens: acc.outputTokens + group.outputTokens,
			cacheReadTokens: acc.cacheReadTokens + group.cacheReadTokens,
			cacheWriteTokens: acc.cacheWriteTokens + group.cacheWriteTokens,
			reasoningTokens: acc.reasoningTokens + group.reasoningTokens,
			costUsd: acc.costUsd + group.costUsd,
			unpricedCount: acc.unpricedCount + group.unpricedCount,
			count: acc.count + group.count,
		}),
		EMPTY_AGGREGATE_TOTALS
	);
}

/** Per-user token/cost totals over `range`, grouped by `groupBy`. Always
 * scoped to the authed user — never accepts a userId/session filter from the
 * client. */
export async function aggregateUsage(
	store: UsageRecordStore,
	userId: string,
	input: z.infer<typeof usageAggregateInput>
) {
	const groups = await store.aggregate({
		userId,
		from: input.range.from,
		to: input.range.to,
		groupBy: input.groupBy,
	});
	return {
		groupBy: input.groupBy,
		range: input.range,
		groups,
		totals: sumAggregateTotals(groups),
	};
}

export const usageRouter = {
	// Per-user token usage over a rolling window (3/7/12 days): daily input/output
	// tokens + cost, plus totals. Aggregated from messages.usage (owner's sessions).
	summary: authorizedUserProcedure
		.input(usageWindowInput)
		.handler(({ input, context }) =>
			summarizeUsage(
				context.services.stores.usage,
				context.authedUser.id,
				input.windowDays
			)
		),
	// Unified token/cost aggregation over `usage_records` (chat + bridge),
	// grouped by day/model/agent/session/source. `userId` always comes from
	// the authed session, never the client.
	aggregate: authorizedUserProcedure
		.input(usageAggregateInput)
		.handler(({ input, context }) =>
			aggregateUsage(
				context.services.stores.usageRecord,
				context.authedUser.id,
				input
			)
		),
};
