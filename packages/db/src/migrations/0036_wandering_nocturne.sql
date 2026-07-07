CREATE TABLE "bridge_token_memories" (
	"token_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"role" text DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_token_memories_token_id_memory_id_pk" PRIMARY KEY("token_id","memory_id")
);
--> statement-breakpoint
ALTER TABLE "bridge_token_memories" ADD CONSTRAINT "bridge_token_memories_token_id_bridge_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."bridge_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_token_memories" ADD CONSTRAINT "bridge_token_memories_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;