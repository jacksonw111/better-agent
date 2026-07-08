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
	const dailySummary = vi.fn().mockResolvedValue(daily);
	const services = {
		authz: { enabled: false },
		stores: {
			activity: { log: () => Promise.resolve() },
			usage: { dailySummary },
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
	return { client, dailySummary };
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
	const { client } = buildClient([
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

it("dailyActivity returns N days of lean per-day rows, scoped to the authed user", async () => {
	const { client, dailySummary } = buildClient([
		{
			day: "2026-04-10",
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

	const res = await client.usage.dailyActivity({ days: 90 });

	expect(dailySummary).toHaveBeenCalledTimes(1);
	const [calledUserId, since] = dailySummary.mock.calls[0] as [string, Date];
	expect(calledUserId).toBe(USER.id);
	// since should be ~90 days before now, not the 3/7/12 window used by `summary`.
	const expectedSince = Date.now() - 90 * 86_400_000;
	expect(Math.abs(since.getTime() - expectedSince)).toBeLessThan(5000);

	expect(res).toEqual([
		{ day: "2026-04-10", turns: 1, totalTokens: 15 },
		{ day: "2026-06-30", turns: 3, totalTokens: 30 },
	]);
});

it("dailyActivity rejects a range beyond the max (180 days)", async () => {
	const { client } = buildClient([]);
	await expect(client.usage.dailyActivity({ days: 181 })).rejects.toThrow();
});

it("dailyActivity rejects non-positive day counts", async () => {
	const { client } = buildClient([]);
	await expect(client.usage.dailyActivity({ days: 0 })).rejects.toThrow();
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

it("aggregate rejects a range longer than the max (366 days) without hitting the store", async () => {
	const { client, aggregate } = buildAggregateClient([]);

	await expect(
		client.usage.aggregate({
			range: { from: new Date("2025-01-01"), to: new Date("2026-06-01") },
			groupBy: "day",
		})
	).rejects.toThrow();
	expect(aggregate).not.toHaveBeenCalled();
});

it("aggregate rejects range.from after range.to without hitting the store", async () => {
	const { client, aggregate } = buildAggregateClient([]);

	await expect(
		client.usage.aggregate({
			range: { from: new Date("2026-06-02"), to: new Date("2026-06-01") },
			groupBy: "day",
		})
	).rejects.toThrow();
	expect(aggregate).not.toHaveBeenCalled();
});

it("aggregate accepts a range at exactly the max (366 days)", async () => {
	const { client, aggregate } = buildAggregateClient([]);

	const res = await client.usage.aggregate({
		range: { from: new Date("2025-06-01"), to: new Date("2026-06-02") },
		groupBy: "day",
	});

	expect(aggregate).toHaveBeenCalledTimes(1);
	expect(res.groups).toEqual([]);
});
