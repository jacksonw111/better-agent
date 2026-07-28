ALTER TABLE "pty_sessions" ADD COLUMN "activity_state" text;--> statement-breakpoint
ALTER TABLE "pty_sessions" ADD COLUMN "activity_state_at" timestamp with time zone;