import type {
	BridgeAgentKind,
	BridgeSessionStatus,
	BridgeTokenConfig,
} from "@better-agent/agent/ports";
import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// A long-lived credential the local bridge CLI uses to authenticate to the
// server on behalf of a user. The sha256 `tokenHash` is what the CLI auths
// against; the raw `bt_`-prefixed `token` is also stored so the owner can
// re-view/copy it on the bound agent's page (owner-only exposure). `agentKind`
// is chosen at creation and bound to the token for its whole life.
export const bridgeTokens = pgTable(
	"bridge_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name"),
		agentKind: text("agent_kind")
			.$type<BridgeAgentKind>()
			.notNull()
			.default("claude-code"),
		tokenHash: text("token_hash").notNull().unique(),
		// Raw token, retrievable by the owner. Nullable: legacy rows were
		// hash-only (created before re-view support) and have no raw token.
		token: text("token"),
		last4: text("last4"),
		// Persisted startup config (Phase 4): appendSystemPrompt, maxTurns, …
		// Nullable: legacy rows predate the column.
		config: jsonb("config").$type<BridgeTokenConfig>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => [index("bridge_tokens_user_id_idx").on(table.userId)]
);

// A single local-agent run relayed through the bridge (one row per CLI
// session, spanning however many turns the local agent handles).
export const bridgeSessions = pgTable(
	"bridge_sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		tokenId: uuid("token_id")
			.notNull()
			.references(() => bridgeTokens.id),
		agentKind: text("agent_kind").$type<BridgeAgentKind>().notNull(),
		label: text("label"),
		// P3-T1: user-set display name from the web's rename flow — distinct from
		// `label`, which the CLI reports at launch time and is never mutated.
		// Nullable: unset until the user renames; display falls back to `label`.
		name: text("name"),
		// The underlying local agent's own conversation id (e.g. claude's
		// `session_id`, captured off its `session_ready` status event) — lets the
		// web show "claude session: <id>" and lets a later CLI run `--resume`
		// this exact conversation. Nullable: unset until the adapter's first
		// `session_ready` event arrives, and never set at all for adapters that
		// don't report one.
		agentSessionId: text("agent_session_id"),
		// The VNC WebSocket endpoint the browser noVNC viewer connects through
		// for a cua/computer-use session. Nullable: only set for sessions that
		// boot a Cua VM; null for every other local-agent run.
		vncEndpoint: text("vnc_endpoint"),
		status: text("status")
			.$type<BridgeSessionStatus>()
			.notNull()
			.default("active"),
		// P3-T1: soft-hide timestamp — set when the user archives the session
		// from the web, cleared on restore. Archived sessions are excluded from
		// the default `listSessions` page and only appear in the archived view.
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		// P3-T1: user-pinned flag; starred sessions sort to the top client-side.
		starred: boolean("starred").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("bridge_sessions_user_id_idx").on(table.userId)]
);

// A single relayed bridge event, persisted so a Local Agent conversation
// survives a page reload — the relay store's window is Redis-only and TTLs
// out. `seq` mirrors the relay's own SERVER-assigned monotonic id (per
// session), so persisted history and the live feed share one ordering and
// the web can dedupe replayed-then-live events by id.
export const bridgeMessages = pgTable(
	"bridge_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sessionId: uuid("session_id")
			.notNull()
			.references(() => bridgeSessions.id),
		seq: bigint("seq", { mode: "number" }).notNull(),
		event: jsonb("event").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("bridge_messages_session_id_seq_idx").on(table.sessionId, table.seq),
		// Partial expression index backing usageByAgentKind's aggregation
		// (bridge-usage-store.ts): that query joins to bridge_sessions and
		// filters WHERE event->>'status' = 'turn_usage' AND created_at >=
		// since, which without this index falls back to a full scan of every
		// row in the table. Only turn_usage rows (one per completed turn, a
		// small fraction of all relayed events) are indexed.
		index("bridge_messages_turn_usage_idx")
			.on(table.sessionId, table.createdAt)
			.where(sql`(${table.event}->>'status') = 'turn_usage'`),
	]
);
