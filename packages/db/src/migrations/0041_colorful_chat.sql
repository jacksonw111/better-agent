ALTER TABLE "bridge_sessions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "bridge_sessions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bridge_sessions" ADD COLUMN "starred" boolean DEFAULT false NOT NULL;