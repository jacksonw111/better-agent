import type {
	FinishReason,
	MessageError,
	MessagePartContent,
	MessagePartType,
	MessageRole,
	MessageStatus,
	MessageUsage,
	PartStatus,
	SessionStatus,
} from "@better-agent/agent/session/types";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const sessions = pgTable(
	"sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		agentId: uuid("agent_id").notNull(),
		userId: uuid("user_id"),
		title: text("title"),
		status: text("status").$type<SessionStatus>().notNull().default("active"),
		summary: text("summary"),
		compactedThroughSeq: integer("compacted_through_seq"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		// Backs session-store.ts's listByUser/listByAgent and usage-store.ts's
		// dailySummary join (both filter/join on these columns without an
		// index today, forcing a seq scan on every call).
		index("sessions_user_id_idx").on(table.userId),
		index("sessions_agent_id_idx").on(table.agentId),
	]
);

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id").notNull(),
		role: text("role").$type<MessageRole>().notNull(),
		seq: integer("seq").notNull(),
		status: text("status").$type<MessageStatus>().notNull(),
		providerId: text("provider_id"),
		modelId: text("model_id"),
		usage: jsonb("usage").$type<MessageUsage>(),
		finishReason: text("finish_reason").$type<FinishReason>(),
		error: jsonb("error").$type<MessageError>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("messages_session_seq").on(table.sessionId, table.seq),
	]
);

export const messageParts = pgTable(
	"message_parts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id").notNull(),
		seq: integer("seq").notNull(),
		type: text("type").$type<MessagePartType>().notNull(),
		content: jsonb("content").$type<MessagePartContent>().notNull(),
		status: text("status").$type<PartStatus>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("message_parts_message_seq").on(table.messageId, table.seq),
	]
);
