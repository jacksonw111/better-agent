import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Knowledge Base documents (user-facing file library). Bytes live in object
// storage (R2); this table holds the metadata + the storage key. A row is
// created in `uploading` when a resumable multipart upload starts (`upload_id`
// carries the S3 multipart id) and flips to `ready` — clearing `upload_id` —
// when the client completes it. `part_size` pins the fixed chunk size the
// whole upload must use, so a resume slices the file identically.
export const knowledgeDocuments = pgTable(
	"knowledge_documents",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerId: uuid("owner_id")
			.notNull()
			.references(() => users.id),
		name: text("name").notNull(),
		mime: text("mime").notNull(),
		size: integer("size").notNull(),
		r2Key: text("r2_key").notNull(),
		status: text("status", { enum: ["uploading", "ready"] })
			.notNull()
			.default("uploading"),
		uploadId: text("upload_id"),
		partSize: integer("part_size").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("knowledge_documents_owner_created").on(
			table.ownerId,
			table.createdAt
		),
		index("knowledge_documents_owner_status").on(table.ownerId, table.status),
	]
);
