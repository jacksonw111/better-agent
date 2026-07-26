CREATE TABLE "pty_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"computer_id" uuid NOT NULL,
	"project_id" uuid,
	"agent_kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pty_sessions" ADD CONSTRAINT "pty_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pty_sessions" ADD CONSTRAINT "pty_sessions_computer_id_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."computers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pty_sessions" ADD CONSTRAINT "pty_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pty_sessions_user_id_computer_id_idx" ON "pty_sessions" USING btree ("user_id","computer_id");