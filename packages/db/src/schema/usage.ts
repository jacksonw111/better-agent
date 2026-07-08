import type { BridgeAgentKind } from "@better-agent/agent/ports";
import {
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

// Unified token-usage ledger — the single source of truth for usage statistics.
// BOTH the chat agent runtime (assistant messages) and the local-agent bridge
// (`turn_usage` events) write here, so the dashboard can aggregate across
// sources/models/sessions without parsing two different JSONB shapes.
//
// `dedup_key` is unique: chat rows use `chat:<messageId>`, bridge rows use
// `bridge:<sessionId>:<seq>` — an upsert on conflict keeps re-finalizes /
// replays from double-counting. `priced` is false when no pricing was known
// (so the UI can show "unknown" instead of a silent $0). See
// docs/usage-stats-plan.md for the full design.
export type UsageSource = "chat" | "bridge";

export const usageRecords = pgTable(
	"usage_records",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id").notNull(),
		source: text("source").$type<UsageSource>().notNull(),
		sessionId: uuid("session_id").notNull(),
		// null for chat (chat has no agentKind; its provider/model are below).
		agentKind: text("agent_kind").$type<BridgeAgentKind | null>(),
		providerId: text("provider_id"),
		modelId: text("model_id"),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
		cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
		cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
		reasoningTokens: integer("reasoning_tokens").notNull().default(0),
		// USD (not cents — the bridge side was already USD; chat's cents are
		// divided by 100 on write). null when `priced` is false.
		costUsd: numeric("cost_usd"),
		priced: boolean("priced").notNull().default(false),
		durationMs: integer("duration_ms"),
		dedupKey: text("dedup_key").notNull(),
		bucketedAt: timestamp("bucketed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		// ON CONFLICT target for the dual-write upsert (re-finalizes / replays
		// refresh the row instead of stacking duplicates).
		uniqueIndex("usage_records_dedup_key_idx").on(table.dedupKey),
		index("usage_records_user_bucketed_idx").on(table.userId, table.bucketedAt),
		index("usage_records_user_agent_idx").on(table.userId, table.agentKind),
		index("usage_records_session_idx").on(table.sessionId),
		index("usage_records_provider_model_idx").on(
			table.providerId,
			table.modelId
		),
	]
);
