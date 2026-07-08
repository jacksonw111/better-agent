CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_kind" text,
	"provider_id" text,
	"model_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric,
	"priced" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"dedup_key" text NOT NULL,
	"bucketed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_dedup_key_idx" ON "usage_records" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "usage_records_user_bucketed_idx" ON "usage_records" USING btree ("user_id","bucketed_at");--> statement-breakpoint
CREATE INDEX "usage_records_user_agent_idx" ON "usage_records" USING btree ("user_id","agent_kind");--> statement-breakpoint
CREATE INDEX "usage_records_session_idx" ON "usage_records" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "usage_records_provider_model_idx" ON "usage_records" USING btree ("provider_id","model_id");