import type {
	ComputerRuntimeInventoryItem,
	ManagedToolInventoryItem,
} from "@better-agent/agent/computer-ports";
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// A user's paired machine running the CLI in client mode (S1-T1). Identity is
// an Ed25519 keypair: the client keeps the private key locally and signs every
// request; `publicKeyPem` is what the server verifies those signatures
// against. A lost identity file means a fresh pair = a new row (no reclaim);
// re-registering the same computerId only refreshes attributes + inventories.
// `lastSeenAt` is bumped by heartbeats — connected/offline is computed from it
// at read time (COMPUTER_OFFLINE_AFTER_MS), never stored.
export const computers = pgTable(
	"computers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		publicKeyPem: text("public_key_pem").notNull(),
		name: text("name").notNull(),
		platform: text("platform"),
		arch: text("arch"),
		clientVersion: text("client_version"),
		// What the machine can run: detected runtimes (with skill capability +
		// discovered skills) and installed-or-not facts for managed tools.
		// Replaced whole on every register; never merged.
		runtimeInventory:
			jsonb("runtime_inventory").$type<ComputerRuntimeInventoryItem[]>(),
		toolInventory: jsonb("tool_inventory").$type<ManagedToolInventoryItem[]>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("computers_user_id_idx").on(table.userId)]
);

// One-time pairing codes minted from the web's "Pair new computer" flow. Only
// the sha256 `codeHash` of the `pc_`-prefixed code is stored; the raw code is
// shown once. A code is consumable while unexpired and unused — consuming it
// sets `usedAt` atomically so it can never pair two Computers.
export const computerPairingCodes = pgTable("computer_pairing_codes", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id),
	codeHash: text("code_hash").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
