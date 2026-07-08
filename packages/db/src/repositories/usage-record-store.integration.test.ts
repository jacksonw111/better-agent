import type { UsageSnapshot } from "@better-agent/agent/usage/usage-record";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { usageRecords } from "../schema/usage";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createUsageRecordStore } from "./usage-record-store";

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
		agentKind: "claude-code",
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
	expect(row.agentKind).toBe("claude-code");
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
	const dedupKey = `bridge:${crypto.randomUUID()}:1`;
	const first = snapshot({ dedupKey, source: "bridge" });
	const second = snapshot({
		dedupKey,
		source: "bridge",
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
		agentKind: undefined,
		providerId: undefined,
		model: undefined,
		durationMs: undefined,
	});

	await store.insert(snap);

	const row = requireRow(await selectByDedupKey(snap.dedupKey));
	expect(row.costUsd).toBeNull();
	expect(row.priced).toBe(false);
	expect(row.agentKind).toBeNull();
	expect(row.providerId).toBeNull();
	expect(row.modelId).toBeNull();
	expect(row.durationMs).toBeNull();
});
