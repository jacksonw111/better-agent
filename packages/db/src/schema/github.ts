import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Server-side GitHub Connection (S4-T1, design D7 / master spec §5.5): one
// per user (user_id unique — upsert replaces the token). The PAT is
// secret-box ciphertext at rest and NEVER leaves the server; API responses
// only ever carry token_last4. credential_type is "pat" in v1, reserved so a
// GitHub App credential can slot in later without touching the Task side.
export const githubConnections = pgTable("github_connections", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.unique()
		.references(() => users.id),
	credentialType: text("credential_type").notNull(),
	encryptedToken: text("encrypted_token").notNull(),
	tokenLast4: text("token_last4").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
