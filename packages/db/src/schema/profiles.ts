import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// The user's Profile (Phase 1, DP1): the server-side single source of truth a
// CLI syncs down to a machine. One row per user (`user_id` unique). `version`
// is bumped on ANY profile-affecting change — its own standards/templates, plus
// the user's skills and MCP servers — so a client can tell, from the version
// alone, that it must re-sync. The bump is centralized in the API layer
// (bumpProfileVersion), never scattered across stores.
export const profiles = pgTable("profiles", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.unique()
		.references(() => users.id),
	version: integer("version").notNull().default(1),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

// A single coding/behaviour standard authored by the user. `enabled` standards
// are concatenated into a managed block in `~/.claude/CLAUDE.md` at sync time;
// `sortOrder` fixes their order there. `body` is markdown rule text.
export const profileStandards = pgTable(
	"profile_standards",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		profileId: uuid("profile_id")
			.notNull()
			.references(() => profiles.id),
		title: text("title").notNull(),
		body: text("body").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("profile_standards_profile_id_idx").on(table.profileId)]
);

// A reusable project scaffold. `scaffold` seeds files + dirs on project
// creation; `claudeMd` is the project-layer CLAUDE.md increment; `mcpServerIds`
// are extra MCP servers (references mcp_servers) wired into the project's
// `.mcp.json`. Stored as jsonb to match the repo convention (see skills).
export const projectTemplates = pgTable(
	"project_templates",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		profileId: uuid("profile_id")
			.notNull()
			.references(() => profiles.id),
		name: text("name").notNull(),
		description: text("description"),
		scaffold: jsonb("scaffold")
			.$type<{ files: { path: string; content: string }[]; dirs: string[] }>()
			.notNull()
			.default({ files: [], dirs: [] }),
		claudeMd: text("claude_md"),
		mcpServerIds: jsonb("mcp_server_ids")
			.$type<string[]>()
			.notNull()
			.default([]),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("project_templates_profile_id_idx").on(table.profileId)]
);
