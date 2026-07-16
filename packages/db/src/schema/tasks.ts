import type { BridgeAgentKind } from "@better-agent/agent/ports";
import type {
	IssueSnapshot,
	RunStatus,
	TaskStatus,
	WorkspaceKind,
} from "@better-agent/agent/task-ports";
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { bridgeSessions } from "./bridge";
import { computers } from "./computers";

// A Task: the user's persistent unit of work (S2-T1, master spec §6.7).
// `description` is the user's instruction verbatim — never rewritten — and
// `openingMessage` is assembled once at creation (§10.1) and immutable. v1
// creates Tasks as `active`; `draft` is a reserved status for future
// save-as-draft / offline queueing, so no migration is needed then.
export const tasks = pgTable(
	"tasks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name").notNull(),
		description: text("description").notNull(),
		status: text("status").$type<TaskStatus>().notNull().default("active"),
		computerId: uuid("computer_id")
			.notNull()
			.references(() => computers.id),
		agentKind: text("agent_kind").$type<BridgeAgentKind>().notNull(),
		// Optional GitHub context (§6.14): both null when the Task has no
		// repository, in which case Runs use a stand-alone workspace.
		repositoryFullName: text("repository_full_name"),
		repositoryUrl: text("repository_url"),
		openingMessage: text("opening_message").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("tasks_user_id_idx").on(table.userId)]
);

// One continuous execution of a Task by an Agent Runtime on a Computer
// (§6.10). `launchKey` (= run id) is the Launch Command idempotency key: its
// unique constraint guarantees the same launch can never be recorded twice.
// `issueSnapshots` belong to the Run — captured at launch time so the row
// records exactly which requirements the Agent saw (§6.15). `sessionId` binds
// the Run to its relay bridge session once the client attaches the runtime.
export const runs = pgTable(
	"runs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id),
		computerId: uuid("computer_id")
			.notNull()
			.references(() => computers.id),
		agentKind: text("agent_kind").$type<BridgeAgentKind>().notNull(),
		status: text("status").$type<RunStatus>().notNull().default("created"),
		launchKey: text("launch_key").notNull().unique(),
		workspaceKind: text("workspace_kind").$type<WorkspaceKind>().notNull(),
		// Client-reported local path once the workspace is prepared.
		workspacePath: text("workspace_path"),
		branch: text("branch"),
		issueSnapshots: jsonb("issue_snapshots")
			.$type<IssueSnapshot[]>()
			.notNull()
			.default([]),
		sessionId: uuid("session_id").references(() => bridgeSessions.id),
		// The real launch/execution error (§16) — never a synthesized message.
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("runs_task_id_idx").on(table.taskId)]
);
