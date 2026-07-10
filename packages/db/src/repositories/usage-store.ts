import type { MessageUsage } from "@better-agent/agent/session/types";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace
import * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DailyUsage {
	costCents: number;
	day: string; // YYYY-MM-DD (UTC)
	inputTokens: number;
	outputTokens: number;
	turns: number;
}

export interface AgentUsage {
	agentId: string;
	costCents: number;
	inputTokens: number;
	name: string;
	outputTokens: number;
	turns: number;
}

export interface UsageStore {
	/** Per-agent token/cost totals, grouped by the owning session's `agentId`. */
	byAgent(userId: string, since: Date): Promise<AgentUsage[]>;
	dailySummary(userId: string, since: Date): Promise<DailyUsage[]>;
}

const num = (value: number | null): number => value ?? 0;

/** Owner's assistant messages with usage recorded, since `since`. Shared by
 * `dailySummary` and `byAgent` — both bucket these plain, JSONB-untouched rows
 * in app code (see `packages/db/.../usage-record-store.ts`'s `aggregateByDay`
 * for the precedent) instead of a `sql\`...\`` fragment, which the repo's
 * no-raw-SQL pre-commit hook rejects unconditionally. */
async function fetchAssistantUsageRows(
	db: Db,
	userId: string,
	since: Date
): Promise<{ createdAt: Date; usage: MessageUsage | null }[]> {
	return await db
		.select({
			createdAt: schema.messages.createdAt,
			usage: schema.messages.usage,
		})
		.from(schema.messages)
		.innerJoin(
			schema.sessions,
			eq(schema.sessions.id, schema.messages.sessionId)
		)
		.where(
			and(
				eq(schema.sessions.userId, userId),
				eq(schema.messages.role, "assistant"),
				gte(schema.messages.createdAt, since),
				isNotNull(schema.messages.usage)
			)
		);
}

function groupRowsByDay(
	rows: Awaited<ReturnType<typeof fetchAssistantUsageRows>>
): DailyUsage[] {
	const byDay = new Map<string, DailyUsage>();
	for (const row of rows) {
		const day = row.createdAt.toISOString().slice(0, 10);
		const acc = byDay.get(day) ?? {
			day,
			inputTokens: 0,
			outputTokens: 0,
			costCents: 0,
			turns: 0,
		};
		acc.inputTokens += num(row.usage?.inputTokens ?? null);
		acc.outputTokens += num(row.usage?.outputTokens ?? null);
		acc.costCents += num(row.usage?.costCents ?? null);
		acc.turns += 1;
		byDay.set(day, acc);
	}
	return [...byDay.values()].sort((a, b) =>
		a.day < b.day ? -1 : Number(a.day > b.day)
	);
}

const UNKNOWN_AGENT_NAME = "Unknown agent";

/** Owner's assistant messages with usage recorded, since `since`, joined to
 * the agent's name. A `leftJoin` (not inner) so a session whose agent was
 * later deleted still contributes its usage under `UNKNOWN_AGENT_NAME`
 * instead of silently vanishing from the user's totals. */
async function fetchAssistantUsageByAgentRows(
	db: Db,
	userId: string,
	since: Date
): Promise<
	{ agentId: string; name: string | null; usage: MessageUsage | null }[]
> {
	return await db
		.select({
			agentId: schema.sessions.agentId,
			name: schema.agents.name,
			usage: schema.messages.usage,
		})
		.from(schema.messages)
		.innerJoin(
			schema.sessions,
			eq(schema.sessions.id, schema.messages.sessionId)
		)
		.leftJoin(schema.agents, eq(schema.agents.id, schema.sessions.agentId))
		.where(
			and(
				eq(schema.sessions.userId, userId),
				eq(schema.messages.role, "assistant"),
				gte(schema.messages.createdAt, since),
				isNotNull(schema.messages.usage)
			)
		);
}

function groupRowsByAgent(
	rows: Awaited<ReturnType<typeof fetchAssistantUsageByAgentRows>>
): AgentUsage[] {
	const byAgent = new Map<string, AgentUsage>();
	for (const row of rows) {
		const acc = byAgent.get(row.agentId) ?? {
			agentId: row.agentId,
			name: row.name ?? UNKNOWN_AGENT_NAME,
			inputTokens: 0,
			outputTokens: 0,
			costCents: 0,
			turns: 0,
		};
		acc.inputTokens += num(row.usage?.inputTokens ?? null);
		acc.outputTokens += num(row.usage?.outputTokens ?? null);
		acc.costCents += num(row.usage?.costCents ?? null);
		acc.turns += 1;
		byAgent.set(row.agentId, acc);
	}
	return [...byAgent.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Per-user token usage aggregated from assistant messages (messages.usage),
 * joined to sessions for the owner. `dailySummary` buckets by UTC day;
 * `byAgent` groups by the session's `agentId` (joined to `agents` for the
 * display name) — cloud (hosted web) agents' per-agent cost/token breakdown,
 * the counterpart of the Local Agents bridge's `usageByAgentKind`.
 */
export function createUsageStore(db: Db): UsageStore {
	return {
		async dailySummary(userId: string, since: Date): Promise<DailyUsage[]> {
			const rows = await fetchAssistantUsageRows(db, userId, since);
			return groupRowsByDay(rows);
		},
		async byAgent(userId: string, since: Date): Promise<AgentUsage[]> {
			const rows = await fetchAssistantUsageByAgentRows(db, userId, since);
			return groupRowsByAgent(rows);
		},
	};
}
