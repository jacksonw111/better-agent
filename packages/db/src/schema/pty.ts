import type { PtySessionStatus } from "@better-agent/agent/pty-session-ports";
import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { computers } from "./computers";
import { projects } from "./projects";

// A persistent PTY session (P25-A, DP-S1): the server's stable record of one
// long-lived terminal on a Computer. The `id` is the sessionId every pty frame
// is multiplexed by; it is minted here BEFORE any pty exists (createSession),
// so re-entering the terminal reattaches the SAME pty instead of spawning a new
// one. Viewer detach never changes this row — only an explicit endSession or
// the CLI-restart reconciliation (endStaleExcept) flips `status` to `ended`.
// `lastActivityAt` is bumped by the CLI's throttled activity signal; the list
// orders by it so the freshest terminal surfaces first.
export const ptySessions = pgTable(
	"pty_sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		computerId: uuid("computer_id")
			.notNull()
			.references(() => computers.id),
		projectId: uuid("project_id").references(() => projects.id),
		agentKind: text("agent_kind").notNull(),
		// The underlying agent's resumable conversation session id (P25-C). For
		// claude/pi it equals `id` (the CLI passes `--session-id <id>`); for
		// codex/opencode it is the id the CLI captures from the agent's own output
		// after the first spawn, so it is null until captured.
		agentSessionId: text("agent_session_id"),
		// Whether the underlying agent conversation has been created at least once.
		// Drives the CLI's create-vs-resume choice on reattach after the pty died
		// (started → `claude --resume` / `codex resume`; not → first-time create).
		agentSessionStarted: boolean("agent_session_started")
			.notNull()
			.default(false),
		title: text("title").notNull(),
		status: text("status")
			.$type<PtySessionStatus>()
			.notNull()
			.default("active"),
		// Fine-grained live activity (observability slice A), reported by the CLI
		// via the STATE frame (0x06). Plain nullable text — NOT an enum — so an
		// evolving upstream state machine is never rejected (starting/working/idle/
		// ended today). `status` stays the authoritative lifecycle; this is the
		// per-turn signal during the live period, also stamped `ended` when the row
		// ends so the two stay consistent.
		activityState: text("activity_state"),
		activityStateAt: timestamp("activity_state_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("pty_sessions_user_id_computer_id_idx").on(
			table.userId,
			table.computerId
		),
	]
);
