import type { UsageSnapshot } from "@better-agent/agent/usage/usage-record";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the whole schema namespace
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface UsageRecordStore {
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

/**
 * Write-side of the unified token-usage ledger (`usage_records`). Both the
 * chat runtime and the local-agent bridge dual-write here via `insert`;
 * `dedupKey` uniqueness makes re-finalizes/replays a no-op instead of
 * double-counting. Aggregation/read is a later task (YAGNI for now).
 */
export function createUsageRecordStore(db: Db): UsageRecordStore {
	return {
		async insert(snapshot: UsageSnapshot): Promise<void> {
			await db
				.insert(schema.usageRecords)
				.values(toValues(snapshot))
				.onConflictDoNothing({ target: schema.usageRecords.dedupKey });
		},
	};
}
