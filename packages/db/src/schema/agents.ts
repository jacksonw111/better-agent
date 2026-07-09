import type { AgentParams } from "@better-agent/agent/agent/types";
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const agents = pgTable(
	"agents",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		description: text("description").notNull(),
		systemPrompt: text("system_prompt").notNull(),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		params: jsonb("params").$type<AgentParams>(),
		// Owner (creator). Null for legacy/global agents created before per-user
		// ownership — those are not listed for any web user (still usable by token).
		userId: uuid("user_id").references(() => users.id),
		// Linked composio account ids. An agent integrates every authenticated
		// toolkit of each linked account.
		composioAccountIds: jsonb("composio_account_ids")
			.$type<string[]>()
			.notNull()
			.default([]),
		// Linked OpenConnector account ids. An agent integrates every
		// authenticated toolkit of each linked account.
		openConnectorAccountIds: jsonb("open_connector_account_ids")
			.$type<string[]>()
			.notNull()
			.default([]),
		// Linked MCP server ids (owner's mcp_servers rows); tools bind per turn.
		mcpServerIds: jsonb("mcp_server_ids")
			.$type<string[]>()
			.notNull()
			.default([]),
		// Optional per-agent tool allowlist (names). Null = all tools of the
		// linked sources.
		toolAllowlist: jsonb("tool_allowlist").$type<string[]>(),
		// Enabled built-in tool ids (see packages/agent/src/tool/builtin-tools.ts).
		builtinTools: jsonb("builtin_tools")
			.$type<string[]>()
			.notNull()
			.default([]),
		tokenHash: text("token_hash").notNull().unique(),
		// The current token, encrypted (secret-box). Lets the admin reuse it for
		// chat instead of relying on a show-once copy. Null for backfilled agents.
		tokenCipher: text("token_cipher"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("agents_user_id_idx").on(table.userId)]
);
