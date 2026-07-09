import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// An OpenConnector account: the owner's own OpenConnector instance, named for
// humans. Toolkits are authenticated against this account (OpenConnector
// scopes connections by the account id), and the owner's agents link to
// accounts to gain tools.
export const openConnectorAccounts = pgTable(
	"open_connector_accounts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		// Owner. Null for legacy admin-era accounts, which are not listed for any
		// web user (agents already linking them keep working).
		userId: uuid("user_id").references(() => users.id),
		baseUrl: text("base_url").notNull(),
		// The admin token, encrypted at rest (secret-box). Never returned to
		// clients — only `adminTokenLast4` is shown, masked.
		adminTokenCipher: text("admin_token_cipher").notNull(),
		adminTokenLast4: text("admin_token_last4").notNull(),
		// The runtime token, encrypted at rest (secret-box). Never returned to
		// clients — only `runtimeTokenLast4` is shown, masked.
		runtimeTokenCipher: text("runtime_token_cipher").notNull(),
		runtimeTokenLast4: text("runtime_token_last4").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("open_connector_accounts_user_id_idx").on(table.userId)]
);
