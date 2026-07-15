import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// P3-T3 (docs/local-agent-workspace-plan.md §P3-3): one Web Push subscription
// per browser/device a user enabled notifications on. `endpoint` is globally
// unique per the Push API spec, so it is both the upsert key (re-subscribing
// from the same browser replaces the row instead of duplicating it) and the
// pruning key when the push provider reports the subscription gone (404/410).
export const pushSubscriptions = pgTable(
	"push_subscriptions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		endpoint: text("endpoint").notNull().unique(),
		// The subscription's ECDH public key + auth secret, both base64url as
		// handed out by PushSubscription.toJSON() — what web-push needs to
		// encrypt payloads for this endpoint.
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		// The subscribing browser's User-Agent, purely informational. Nullable:
		// not every client sends one.
		userAgent: text("user_agent"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("push_subscriptions_user_id_idx").on(table.userId)]
);
