CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"r2_key" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"upload_id" text,
	"part_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_documents_owner_created" ON "knowledge_documents" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_documents_owner_status" ON "knowledge_documents" USING btree ("owner_id","status");