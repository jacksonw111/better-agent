import type { UsageSnapshot } from "@better-agent/agent/usage/usage-record";
import { and, count, eq, gte, lte, sum } from "drizzle-orm";
import type {
	PgColumn,
	PgDatabase,
	PgQueryResultHKT,
} from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type UsageGroupBy = "day" | "model" | "agent" | "session" | "source";

export interface UsageAggregateRow {
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** SUM of non-null cost_usd only — unpriced rows are excluded, not $0. */
	costUsd: number;
	/** Total rows (turns) in the group. */
	count: number;
	inputTokens: number;
	/** ISO date (day, "YYYY-MM-DD") | modelId | agentKind | sessionId | source;
	 * a null dimension column (modelId/agentKind) groups under "unknown". */
	key: string;
	outputTokens: number;
	reasoningTokens: number;
	/** COUNT of rows with `priced: false`, so the UI can show "unknown". */
	unpricedCount: number;
}

export interface UsageAggregateInput {
	from: Date;
	groupBy: UsageGroupBy;
	to: Date;
	userId: string;
}

export interface UsageRecordStore {
	/** Token/cost totals for `userId` in `[from, to]`, grouped by `groupBy`.
	 * Ordered by `key` ascending. */
	aggregate(input: UsageAggregateInput): Promise<UsageAggregateRow[]>;
	/** Idempotent: a duplicate dedupKey is a no-op (prevents double-counting). */
	insert(snapshot: UsageSnapshot): Promise<void>;
}

// drizzle's `numeric` column maps to `string` on insert; costUsd is null when
// pricing is unknown (`priced: false`), in which case the column is omitted
// so the DB's own null default applies.
function toValues(snapshot: UsageSnapshot) {
	return {
		userId: snapshot.userId,
		source: snapshot.source,
		sessionId: snapshot.sessionId,
		agentKind: snapshot.agentKind,
		providerId: snapshot.providerId,
		modelId: snapshot.model,
		inputTokens: snapshot.tokens.input,
		outputTokens: snapshot.tokens.output,
		cacheReadTokens: snapshot.tokens.cacheRead,
		cacheWriteTokens: snapshot.tokens.cacheWrite,
		reasoningTokens: snapshot.tokens.reasoning,
		costUsd: snapshot.costUsd === null ? undefined : String(snapshot.costUsd),
		priced: snapshot.priced,
		durationMs: snapshot.durationMs,
		dedupKey: snapshot.dedupKey,
	};
}

// `day` buckets by calendar date, which needs a `date_trunc(...)` SQL
// expression — the repo's `no-raw-sql` pre-commit hook flags ANY `sql\`...\``
// tagged template inside packages/db/ (even as a select/group fragment), so
// "day" is bucketed in JS from the raw `bucketedAt` column instead of in the
// query. The other dimensions are plain columns, so they use one drizzle
// `groupBy()` query with builder-native `sum()`/`count()` aggregates.
const GROUP_BY_COLUMN: Record<Exclude<UsageGroupBy, "day">, PgColumn> = {
	model: schema.usageRecords.modelId,
	agent: schema.usageRecords.agentKind,
	session: schema.usageRecords.sessionId,
	source: schema.usageRecords.source,
};

// `sum()` on int/numeric columns returns `string | null` in drizzle/pg
// (Postgres numeric/bigint aggregates come back as strings to avoid JS
// precision loss); coerce to a number and never let a null sum become NaN.
const toNumber = (value: string | number | null): number => Number(value) || 0;

interface RawAggregateRow {
	cacheReadTokens: string | number | null;
	cacheWriteTokens: string | number | null;
	costUsd: string | number | null;
	count: number;
	inputTokens: string | number | null;
	key: string | null;
	outputTokens: string | number | null;
	pricedCount: number;
	reasoningTokens: string | number | null;
}

function toAggregateRow(row: RawAggregateRow): UsageAggregateRow {
	return {
		key: row.key ?? "unknown",
		inputTokens: toNumber(row.inputTokens),
		outputTokens: toNumber(row.outputTokens),
		cacheReadTokens: toNumber(row.cacheReadTokens),
		cacheWriteTokens: toNumber(row.cacheWriteTokens),
		reasoningTokens: toNumber(row.reasoningTokens),
		costUsd: toNumber(row.costUsd),
		// `priced: false` rows always have a null cost_usd (the write side never
		// stores a cost it isn't sure of), so unpriced = total - priced(non-null cost).
		unpricedCount: row.count - row.pricedCount,
		count: row.count,
	};
}

function byKeyAscending(a: UsageAggregateRow, b: UsageAggregateRow): number {
	return a.key < b.key ? -1 : Number(a.key > b.key);
}

async function aggregateByColumn(
	db: Db,
	input: UsageAggregateInput,
	column: PgColumn
): Promise<UsageAggregateRow[]> {
	const rows = await db
		.select({
			key: column,
			inputTokens: sum(schema.usageRecords.inputTokens),
			outputTokens: sum(schema.usageRecords.outputTokens),
			cacheReadTokens: sum(schema.usageRecords.cacheReadTokens),
			cacheWriteTokens: sum(schema.usageRecords.cacheWriteTokens),
			reasoningTokens: sum(schema.usageRecords.reasoningTokens),
			costUsd: sum(schema.usageRecords.costUsd),
			pricedCount: count(schema.usageRecords.costUsd),
			count: count(),
		})
		.from(schema.usageRecords)
		.where(
			and(
				eq(schema.usageRecords.userId, input.userId),
				gte(schema.usageRecords.bucketedAt, input.from),
				lte(schema.usageRecords.bucketedAt, input.to)
			)
		)
		.groupBy(column);
	return rows
		.map((row) => toAggregateRow(row as RawAggregateRow))
		.sort(byKeyAscending);
}

async function aggregateByDay(
	db: Db,
	input: UsageAggregateInput
): Promise<UsageAggregateRow[]> {
	const rows = await db
		.select({
			day: schema.usageRecords.bucketedAt,
			inputTokens: schema.usageRecords.inputTokens,
			outputTokens: schema.usageRecords.outputTokens,
			cacheReadTokens: schema.usageRecords.cacheReadTokens,
			cacheWriteTokens: schema.usageRecords.cacheWriteTokens,
			reasoningTokens: schema.usageRecords.reasoningTokens,
			costUsd: schema.usageRecords.costUsd,
			priced: schema.usageRecords.priced,
		})
		.from(schema.usageRecords)
		.where(
			and(
				eq(schema.usageRecords.userId, input.userId),
				gte(schema.usageRecords.bucketedAt, input.from),
				lte(schema.usageRecords.bucketedAt, input.to)
			)
		);
	return groupRowsByDay(rows);
}

interface DayRow {
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd: string | number | null;
	day: Date;
	inputTokens: number;
	outputTokens: number;
	priced: boolean;
	reasoningTokens: number;
}

function groupRowsByDay(rows: DayRow[]): UsageAggregateRow[] {
	const byDay = new Map<string, UsageAggregateRow>();
	for (const row of rows) {
		const key = row.day.toISOString().slice(0, 10);
		const acc = byDay.get(key) ?? {
			key,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			costUsd: 0,
			unpricedCount: 0,
			count: 0,
		};
		acc.inputTokens += row.inputTokens;
		acc.outputTokens += row.outputTokens;
		acc.cacheReadTokens += row.cacheReadTokens;
		acc.cacheWriteTokens += row.cacheWriteTokens;
		acc.reasoningTokens += row.reasoningTokens;
		acc.costUsd += toNumber(row.costUsd);
		acc.unpricedCount += row.priced ? 0 : 1;
		acc.count += 1;
		byDay.set(key, acc);
	}
	return [...byDay.values()].sort(byKeyAscending);
}

/**
 * Write-side of the unified token-usage ledger (`usage_records`). Both the
 * chat runtime and the local-agent bridge dual-write here via `insert`;
 * `dedupKey` uniqueness makes re-finalizes/replays a no-op instead of
 * double-counting. `aggregate` is the shared read-side for the usage
 * dashboard: token/cost totals grouped by day/model/agent/session/source.
 */
export function createUsageRecordStore(db: Db): UsageRecordStore {
	return {
		async insert(snapshot: UsageSnapshot): Promise<void> {
			await db
				.insert(schema.usageRecords)
				.values(toValues(snapshot))
				.onConflictDoNothing({ target: schema.usageRecords.dedupKey });
		},
		aggregate(input: UsageAggregateInput): Promise<UsageAggregateRow[]> {
			if (input.groupBy === "day") {
				return aggregateByDay(db, input);
			}
			return aggregateByColumn(db, input, GROUP_BY_COLUMN[input.groupBy]);
		},
	};
}
