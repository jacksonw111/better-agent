ALTER TABLE "pty_sessions" ADD COLUMN "agent_session_id" text;--> statement-breakpoint
ALTER TABLE "pty_sessions" ADD COLUMN "agent_session_started" boolean DEFAULT false NOT NULL;