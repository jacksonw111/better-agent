import type { MessageUsage } from "@better-agent/agent/session/types";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agents } from "../schema/agents";
import { users } from "../schema/auth";
import { messages, sessions } from "../schema/sessions";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createUsageStore } from "./usage-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

const usage = (
	inputTokens: number,
	outputTokens: number,
	costCents: number
): MessageUsage => ({
	inputTokens,
	outputTokens,
	costCents,
	totalTokens: inputTokens + outputTokens,
	reasoningTokens: null,
	cacheReadTokens: null,
	cacheWriteTokens: null,
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedSession(userId: string, agentId?: string): Promise<string> {
	const [row] = await db
		.insert(sessions)
		.values({ agentId: agentId ?? crypto.randomUUID(), userId })
		.returning();
	return row?.id ?? "";
}

async function seedAgent(name: string): Promise<string> {
	const [row] = await db
		.insert(agents)
		.values({
			name,
			description: "",
			systemPrompt: "",
			providerId: "openai",
			modelId: "gpt-5",
			tokenHash: crypto.randomUUID(),
		})
		.returning();
	return row?.id ?? "";
}

function msg(
	sessionId: string,
	seq: number,
	role: "assistant" | "user",
	createdAt: Date,
	use: MessageUsage | null
) {
	return {
		sessionId,
		role,
		seq,
		status: "complete" as const,
		createdAt,
		usage: use,
	};
}

const DAY = new Date("2026-06-30T10:00:00.000Z");
const SINCE = new Date("2026-06-01T00:00:00.000Z");

it("dailySummary aggregates the user's assistant-message usage per day", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("me@x.com");
	const mine = await seedSession(meId);
	const theirs = await seedSession(await seedUser("other@x.com"));
	await db.insert(messages).values([
		msg(mine, 1, "assistant", DAY, usage(100, 50, 2)),
		msg(mine, 2, "assistant", DAY, usage(20, 10, 1)),
		msg(mine, 3, "user", DAY, null), // ignored: not assistant
		msg(theirs, 1, "assistant", DAY, usage(999, 999, 99)), // ignored: other user
	]);

	const summary = await store.dailySummary(meId, SINCE);
	expect(summary).toHaveLength(1);
	expect(summary[0]?.day).toBe("2026-06-30");
	expect(summary[0]?.inputTokens).toBe(120);
	expect(summary[0]?.outputTokens).toBe(60);
	expect(summary[0]?.costCents).toBe(3);
	expect(summary[0]?.turns).toBe(2);
});

it("dailySummary excludes messages older than the since date", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("a@x.com");
	const s = await seedSession(meId);
	await db
		.insert(messages)
		.values(
			msg(
				s,
				1,
				"assistant",
				new Date("2026-05-01T00:00:00.000Z"),
				usage(10, 10, 1)
			)
		);
	expect(await store.dailySummary(meId, SINCE)).toHaveLength(0);
});

it("byAgent groups and sums usage per agent for the owner, excluding other users", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("agents-me@x.com");
	const research = await seedAgent("Research Bot");
	const support = await seedAgent("Support Bot");
	const mineResearch = await seedSession(meId, research);
	const mineResearchAgain = await seedSession(meId, research);
	const mineSupport = await seedSession(meId, support);
	const theirs = await seedSession(
		await seedUser("agents-other@x.com"),
		research
	);

	await db.insert(messages).values([
		msg(mineResearch, 1, "assistant", DAY, usage(100, 50, 2)),
		msg(mineResearchAgain, 1, "assistant", DAY, usage(20, 10, 1)),
		msg(mineSupport, 1, "assistant", DAY, usage(5, 5, 1)),
		msg(mineResearch, 2, "user", DAY, null), // ignored: not assistant
		msg(theirs, 1, "assistant", DAY, usage(999, 999, 99)), // ignored: other user
	]);

	const rows = await store.byAgent(meId, SINCE);
	const byName = new Map(rows.map((row) => [row.name, row]));

	expect(rows).toHaveLength(2);
	expect(byName.get("Research Bot")).toEqual({
		agentId: research,
		name: "Research Bot",
		inputTokens: 120,
		outputTokens: 60,
		costCents: 3,
		turns: 2,
	});
	expect(byName.get("Support Bot")).toEqual({
		agentId: support,
		name: "Support Bot",
		inputTokens: 5,
		outputTokens: 5,
		costCents: 1,
		turns: 1,
	});
});

it("byAgent falls back to a placeholder name when the agent no longer exists", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("orphan@x.com");
	const orphanAgentId = crypto.randomUUID();
	const s = await seedSession(meId, orphanAgentId);
	await db
		.insert(messages)
		.values(msg(s, 1, "assistant", DAY, usage(10, 5, 1)));

	const rows = await store.byAgent(meId, SINCE);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.agentId).toBe(orphanAgentId);
	expect(rows[0]?.name).toBe("Unknown agent");
});

it("byAgent excludes usage older than the since date", async () => {
	const store = createUsageStore(db);
	const meId = await seedUser("old-agent@x.com");
	const agentId = await seedAgent("Old Bot");
	const s = await seedSession(meId, agentId);
	await db
		.insert(messages)
		.values(
			msg(
				s,
				1,
				"assistant",
				new Date("2026-05-01T00:00:00.000Z"),
				usage(10, 10, 1)
			)
		);
	expect(await store.byAgent(meId, SINCE)).toHaveLength(0);
});
