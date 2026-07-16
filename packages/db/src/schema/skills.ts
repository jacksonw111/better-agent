import {
	boolean,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";

// A reusable method/procedure bundle assigned to an agent (docs/web-agent-skills-plan.md
// T1): { name, description, instructions, allowedTools?, mcpServerIds? }. The
// owner (`userId`) creates it; agents are linked via `agent_skills`. Modeled
// exactly on `memories` (packages/db/src/schema/memory.ts).
//
// Built-in skills (`isBuiltin=true`, `userId=null`) are org-provided templates
// seeded at deploy (apps/server/src/seed-skills.ts) — visible read-only to
// every user and assignable to their agents, but never editable/deletable
// through the owner-scoped router. See docs/research/2026-07-15-quantskills-integration.md.
export const skills = pgTable(
	"skills",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// Nullable: built-in skills have no owner. User-created skills always set it.
		userId: uuid("user_id").references(() => users.id),
		isBuiltin: boolean("is_builtin").notNull().default(false),
		name: text("name").notNull(),
		description: text("description"),
		instructions: text("instructions"),
		// Optional per-skill tool allowlist (names), folded into the turn's
		// toolset on activation. Null = no restriction beyond the agent's own.
		allowedTools: jsonb("allowed_tools").$type<string[]>(),
		// Linked MCP server ids, folded into the turn's toolset on activation.
		mcpServerIds: jsonb("mcp_server_ids").$type<string[]>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("skills_user_id_idx").on(table.userId)]
);

// Many-to-many agent↔skill link. Unlike `agent_memories`, a skill carries no
// per-link role — it is either assigned to an agent or it isn't.
export const agentSkills = pgTable(
	"agent_skills",
	{
		agentId: uuid("agent_id")
			.notNull()
			.references(() => agents.id),
		skillId: uuid("skill_id")
			.notNull()
			.references(() => skills.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.agentId, table.skillId] }),
		index("agent_skills_agent_id_idx").on(table.agentId),
	]
);
