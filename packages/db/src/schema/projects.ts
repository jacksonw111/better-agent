import type { ProjectStatus } from "@better-agent/agent/project-ports";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { computers } from "./computers";

// A Project (Q1): a long-lived checkout of one GitHub repository on one
// Computer — fixed directory, cloned once, shared as the cwd by every session
// started against it. `status` doubles as the clone-delivery queue (D4's
// "queue IS the state"): a still-`created` row renders as a pending
// `clone_project` command until the client acks it to `cloning`, then reports
// `ready` (+local_path) or `error` (+error_message). `encrypted_token` is
// secret-box ciphertext of the user's per-Computer repo credential (nullable —
// public repos need none); it is decrypted once into the clone command for
// client-side git auth, a deliberate product decision distinct from the
// server-side GitHub Connection which never leaves the server. `local_path`
// is client-reported (`~/.better-agent/projects/<id前8>-<repo短名>/`) — the
// server never invents filesystem paths.
export const projects = pgTable(
	"projects",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		computerId: uuid("computer_id")
			.notNull()
			.references(() => computers.id),
		name: text("name").notNull(),
		repoFullName: text("repo_full_name").notNull(),
		repoCloneUrl: text("repo_clone_url").notNull(),
		encryptedToken: text("encrypted_token"),
		tokenLast4: text("token_last4"),
		status: text("status").$type<ProjectStatus>().notNull().default("created"),
		errorMessage: text("error_message"),
		localPath: text("local_path"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("projects_user_id_computer_id_idx").on(
			table.userId,
			table.computerId
		),
	]
);
