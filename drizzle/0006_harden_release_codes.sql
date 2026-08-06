ALTER TABLE "claims" ADD COLUMN "release_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "release_code_attempts" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "release_code_locked_until" timestamp with time zone;