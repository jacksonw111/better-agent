CREATE TABLE "open_connector_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"base_url" text NOT NULL,
	"admin_token_cipher" text NOT NULL,
	"admin_token_last4" text NOT NULL,
	"runtime_token_cipher" text NOT NULL,
	"runtime_token_last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "open_connector_account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "open_connector_accounts" ADD CONSTRAINT "open_connector_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "open_connector_accounts_user_id_idx" ON "open_connector_accounts" USING btree ("user_id");