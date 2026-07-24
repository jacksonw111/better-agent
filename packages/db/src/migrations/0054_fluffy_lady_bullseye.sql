ALTER TABLE "memories" ADD COLUMN "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_user_scope_idx" ON "memories" USING btree ("user_id","scope","project_id");