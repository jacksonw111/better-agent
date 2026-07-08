import type { UsageAggregateRow } from "@better-agent/db/repositories/usage-record-store";
import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import { appRouter } from "./index";

const USER = { id: "u1", email: "u@x.com", createdAt: new Date() };

function buildClient(
	daily: Array<{
		costCents: number;
		day: string;
		inputTokens: number;
		outputTokens: number;
		turns: number;
	}>
) {
	const services = {
		authz: { enabled: false },
		stores: {
			activity: { log: () => Promise.resolve() },
			usage: { dailySummary: () => Promise.resolve(daily) },
		},
	};
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

function buildAggregateClient(groups: UsageAggregateRow[]) {
	const aggregate = vi.fn().mockResolvedValue(groups);
	const services = {
		authz: { enabled: false },
		stores: {
			activity: { log: () => Promise.resolve() },
			usageRecord: { aggregate },
		},
	};
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: USER,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { client, aggregate };
}

it("summary returns the daily rows and summed totals for the window", async () => {
	const client = buildClient([
		{
			day: "2026-06-29",
			inputTokens: 10,
			outputTokens: 5,
			costCents: 1,
			turns: 1,
		},
		{
			day: "2026-06-30",
			inputTokens: 20,
			outputTokens: 10,
			costCents: 2,
			turns: 3,
		},
	]);
	const res = await client.usage.summary({ windowDays: 7 });
	expect(res.windowDays).toBe(7);
	expect(res.daily).toHaveLength(2);
	expect(res.totals).toEqual({
		inputTokens: 30,
		outputTokens: 15,
		costCents: 3,
		turns: 4,
	});
});

it("aggregate scopes to the authed user and sums totals across groups", async () => {
	const groups: UsageAggregateRow[] = [
		{
			key: "claude-opus-4-5",
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 1,
			cacheWriteTokens: 1,
			reasoningTokens: 0,
			costUsd: 1.5,
			unpricedCount: 0,
			count: 2,
		},
		{
			key: "gpt-5",
			inputTokens: 20,
			outputTokens: 10,
			cacheReadTokens: 2,
			cacheWriteTokens: 2,
			reasoningTokens: 1,
			costUsd: 0,
			unpricedCount: 1,
			count: 1,
		},
	];
	const { client, aggregate } = buildAggregateClient(groups);

	const res = await client.usage.aggregate({
		range: { from: new Date("2026-06-01"), to: new Date("2026-06-02") },
		groupBy: "model",
	});

	expect(aggregate).toHaveBeenCalledWith(
		expect.objectContaining({ userId: USER.id, groupBy: "model" })
	);
	expect(res.groupBy).toBe("model");
	expect(res.groups).toEqual(groups);
	expect(res.totals).toEqual({
		inputTokens: 30,
		outputTokens: 15,
		cacheReadTokens: 3,
		cacheWriteTokens: 3,
		reasoningTokens: 1,
		costUsd: 1.5,
		unpricedCount: 1,
		count: 3,
	});
});
