ALTER TABLE "bridge_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "computer_pairing_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "computers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "github_connections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bridge_token_memories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profile_standards" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_templates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pty_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "bridge_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "bridge_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "computer_pairing_codes" CASCADE;--> statement-breakpoint
DROP TABLE "computers" CASCADE;--> statement-breakpoint
DROP TABLE "github_connections" CASCADE;--> statement-breakpoint
DROP TABLE "bridge_token_memories" CASCADE;--> statement-breakpoint
DROP TABLE "profile_standards" CASCADE;--> statement-breakpoint
DROP TABLE "profiles" CASCADE;--> statement-breakpoint
DROP TABLE "project_templates" CASCADE;--> statement-breakpoint
DROP TABLE "projects" CASCADE;--> statement-breakpoint
DROP TABLE "pty_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "push_subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "runs" CASCADE;--> statement-breakpoint
DROP TABLE "tasks" CASCADE;--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT IF EXISTS "memories_project_id_projects_id_fk";
--> statement-breakpoint
DROP INDEX "memories_user_scope_idx";--> statement-breakpoint
DROP INDEX "usage_records_user_agent_idx";--> statement-breakpoint
DROP INDEX "memory_items_memory_id_current_idx";--> statement-breakpoint
CREATE INDEX "memory_items_memory_id_current_idx" ON "memory_items" USING btree ("memory_id") WHERE "memory_items"."valid_to" is null;--> statement-breakpoint
ALTER TABLE "usage_records" DROP COLUMN "agent_kind";