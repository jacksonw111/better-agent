import type { UsageSnapshot } from "@better-agent/agent/usage/usage-record";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { usageRecords } from "../schema/usage";
import { createTestDb, type TestDb } from "../testing/test-db";
import {
	createUsageRecordStore,
	type UsageAggregateRow,
} from "./usage-record-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function selectByDedupKey(dedupKey: string) {
	return await db
		.select()
		.from(usageRecords)
		.where(eq(usageRecords.dedupKey, dedupKey));
}

function requireRow<T>(rows: T[]): T {
	const row = rows[0];
	if (!row) {
		throw new Error("expected a row but found none");
	}
	return row;
}

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
	return {
		source: "chat",
		userId: crypto.randomUUID(),
		sessionId: crypto.randomUUID(),
		providerId: "anthropic",
		model: "claude-opus-4-5",
		tokens: {
			input: 100,
			output: 50,
			cacheRead: 10,
			cacheWrite: 5,
			reasoning: 2,
		},
		costUsd: 1.23,
		priced: true,
		durationMs: 4200,
		dedupKey: `chat:${crypto.randomUUID()}`,
		...overrides,
	};
}

it("insert persists a row with the mapped columns", async () => {
	const store = createUsageRecordStore(db);
	const snap = snapshot();

	await store.insert(snap);

	const rows = await selectByDedupKey(snap.dedupKey);
	expect(rows).toHaveLength(1);
	const row = requireRow(rows);
	expect(row.userId).toBe(snap.userId);
	expect(row.sessionId).toBe(snap.sessionId);
	expect(row.source).toBe("chat");
	expect(row.providerId).toBe("anthropic");
	expect(row.modelId).toBe("claude-opus-4-5");
	expect(row.inputTokens).toBe(100);
	expect(row.outputTokens).toBe(50);
	expect(row.cacheReadTokens).toBe(10);
	expect(row.cacheWriteTokens).toBe(5);
	expect(row.reasoningTokens).toBe(2);
	expect(row.costUsd).toBe("1.23");
	expect(row.priced).toBe(true);
	expect(row.durationMs).toBe(4200);
	expect(row.dedupKey).toBe(snap.dedupKey);
});

it("insert is idempotent on dedupKey: a duplicate insert is a no-op", async () => {
	const store = createUsageRecordStore(db);
	const dedupKey = `chat:${crypto.randomUUID()}`;
	const first = snapshot({ dedupKey });
	const second = snapshot({
		dedupKey,
		tokens: {
			input: 999,
			output: 999,
			cacheRead: 999,
			cacheWrite: 999,
			reasoning: 999,
		},
	});

	await store.insert(first);
	await store.insert(second);

	const rows = await selectByDedupKey(dedupKey);
	expect(rows).toHaveLength(1);
	expect(requireRow(rows).inputTokens).toBe(100);
});

it("persists unpriced snapshots with null costUsd and DB defaults for omitted fields", async () => {
	const store = createUsageRecordStore(db);
	const snap = snapshot({
		costUsd: null,
		priced: false,
		providerId: undefined,
		model: undefined,
		durationMs: undefined,
	});

	await store.insert(snap);

	const row = requireRow(await selectByDedupKey(snap.dedupKey));
	expect(row.costUsd).toBeNull();
	expect(row.priced).toBe(false);
	expect(row.providerId).toBeNull();
	expect(row.modelId).toBeNull();
	expect(row.durationMs).toBeNull();
});

const DAY1 = new Date("2026-06-01T12:00:00.000Z");
const DAY2 = new Date("2026-06-02T08:00:00.000Z");
const WINDOW = {
	from: new Date("2026-06-01T00:00:00.000Z"),
	to: new Date("2026-06-02T23:59:59.000Z"),
};

type Tokens = [number, number, number, number, number]; // input, output, cacheRead, cacheWrite, reasoning
type Row = [
	dedupKey: string,
	modelId: string | null,
	tokens: Tokens,
	costUsd: string | null,
	priced: boolean,
	bucketedAt: Date,
];

// Two days, a mix of priced/unpriced and named/null model dimensions — shared
// by the groupBy:day/model/source assertions below.
const ROWS: Row[] = [
	["r1", "claude-opus-4-5", [10, 5, 1, 1, 0], "1.00", true, DAY1],
	["r2", "gpt-5", [20, 10, 2, 2, 1], null, false, DAY1],
	["r3", "claude-opus-4-5", [30, 15, 3, 3, 0], "2.50", true, DAY2],
	["r4", null, [40, 20, 4, 4, 2], "0.75", true, DAY2],
];

// Inserts directly (bypassing `store.insert`, which always stamps `bucketedAt`
// via the DB's `defaultNow()`) so tests can control which calendar day a row
// falls on and pin every other dimension.
async function insertRow(userId: string, row: Row) {
	const [input, output, cacheRead, cacheWrite, reasoning] = row[2];
	await db.insert(usageRecords).values({
		userId,
		source: "chat",
		sessionId: crypto.randomUUID(),
		modelId: row[1],
		inputTokens: input,
		outputTokens: output,
		cacheReadTokens: cacheRead,
		cacheWriteTokens: cacheWrite,
		reasoningTokens: reasoning,
		costUsd: row[3],
		priced: row[4],
		dedupKey: `${userId}:${row[0]}`,
		bucketedAt: row[5],
	});
}

// Seeds `ROWS` for `userId`, plus one big row for an unrelated random user —
// every aggregate test below asserts that row is excluded (user-scoping).
async function seedRows(userId: string) {
	for (const row of ROWS) {
		await insertRow(userId, row);
	}
	await insertRow(crypto.randomUUID(), [
		"other-user",
		"claude-opus-4-5",
		[9999, 9999, 9999, 9999, 9999],
		"999.00",
		true,
		DAY1,
	]);
}

function aggregateRow(
	key: string,
	t: Tokens,
	costUsd: number,
	unpricedCount: number,
	count: number
): UsageAggregateRow {
	return {
		key,
		inputTokens: t[0],
		outputTokens: t[1],
		cacheReadTokens: t[2],
		cacheWriteTokens: t[3],
		reasoningTokens: t[4],
		costUsd,
		unpricedCount,
		count,
	};
}

it("aggregate groupBy:day sums per-day tokens/cost and scopes to the user", async () => {
	const store = createUsageRecordStore(db);
	const userId = crypto.randomUUID();
	await seedRows(userId);

	const rows = await store.aggregate({ userId, ...WINDOW, groupBy: "day" });

	expect(rows).toEqual([
		aggregateRow("2026-06-01", [30, 15, 3, 3, 1], 1, 1, 2),
		aggregateRow("2026-06-02", [70, 35, 7, 7, 2], 3.25, 0, 2),
	]);
});

it("aggregate groupBy:model sums per-model tokens/cost, nulls to 'unknown'", async () => {
	const store = createUsageRecordStore(db);
	const userId = crypto.randomUUID();
	await seedRows(userId);

	const rows = await store.aggregate({ userId, ...WINDOW, groupBy: "model" });

	expect(rows).toEqual([
		aggregateRow("claude-opus-4-5", [40, 20, 4, 4, 0], 3.5, 0, 2),
		aggregateRow("gpt-5", [20, 10, 2, 2, 1], 0, 1, 1),
		aggregateRow("unknown", [40, 20, 4, 4, 2], 0.75, 0, 1),
	]);
});

it("aggregate groupBy:source sums per-source tokens, excluding unpriced from costUsd", async () => {
	const store = createUsageRecordStore(db);
	const userId = crypto.randomUUID();
	await seedRows(userId);

	const rows = await store.aggregate({ userId, ...WINDOW, groupBy: "source" });

	expect(rows).toEqual([
		aggregateRow("chat", [100, 50, 10, 10, 3], 4.25, 1, 4),
	]);
});
