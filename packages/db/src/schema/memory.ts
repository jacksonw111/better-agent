import type { MemoryItemSource, MemoryRole } from "@better-agent/agent/ports";
import { sql } from "drizzle-orm";
import {
	index,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uuid,
	vector,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";

// Cloudflare Workers AI `bge-base` output width (decision D1). The embedding
// table is split from memory_items so switching models / re-embedding never
// rewrites the facts — only this column's dimension is model-bound.
const EMBEDDING_DIMENSIONS = 768;
// A curated fact carries no learned salience yet; start every item mid-scale.
const DEFAULT_IMPORTANCE = 0.5;

// A named, ownable, shareable knowledge base (decision A1/C2). The owner
// (`userId`) creates it; agents are linked via `agent_memories`.
export const memories = pgTable(
	"memories",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		name: text("name").notNull(),
		description: text("description"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("memories_user_id_idx").on(table.userId)]
);

// Many-to-many agent↔memory link with a per-link role (decision C2): one
// knowledge base can be shared across agents, and each agent is read-only by
// default unless explicitly granted read_write. Keyed to `agents` for M1;
// local/bridge agents reuse the same table via their agent id.
export const agentMemories = pgTable(
	"agent_memories",
	{
		agentId: uuid("agent_id")
			.notNull()
			.references(() => agents.id),
		memoryId: uuid("memory_id")
			.notNull()
			.references(() => memories.id),
		role: text("role").$type<MemoryRole>().notNull().default("read"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.agentId, table.memoryId] })]
);

// The atomic, retrievable facts. `validTo` is a soft-delete watermark: null =
// current, a timestamp = superseded/removed but recoverable. The partial index
// backs the hot read path (current items of a memory / the kNN candidate set).
export const memoryItems = pgTable(
	"memory_items",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		memoryId: uuid("memory_id")
			.notNull()
			.references(() => memories.id),
		content: text("content").notNull(),
		source: text("source").$type<MemoryItemSource>().notNull().default("user"),
		importance: real("importance").notNull().default(DEFAULT_IMPORTANCE),
		validFrom: timestamp("valid_from", { withTimezone: true })
			.notNull()
			.defaultNow(),
		validTo: timestamp("valid_to", { withTimezone: true }),
		lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("memory_items_memory_id_current_idx")
			.on(table.memoryId)
			.where(sql`${table.validTo} IS NULL`),
	]
);

// One embedding per item (M1). Split from memory_items so re-embedding / model
// A-B tests never touch the fact rows. HNSW + cosine ops for kNN retrieval (E1).
export const memoryEmbeddings = pgTable(
	"memory_embeddings",
	{
		itemId: uuid("item_id")
			.primaryKey()
			.references(() => memoryItems.id),
		embedding: vector("embedding", {
			dimensions: EMBEDDING_DIMENSIONS,
		}).notNull(),
		model: text("model").notNull(),
	},
	(table) => [
		index("memory_embeddings_hnsw_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops")
		),
	]
);
