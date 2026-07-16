ALTER TABLE "skills" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "is_builtin" boolean DEFAULT false NOT NULL;