CREATE TYPE "public"."mom_document_type" AS ENUM('MoM', 'LOA');--> statement-breakpoint
CREATE SEQUENCE "public"."claim_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 123 CACHE 1;--> statement-breakpoint
ALTER TABLE "liquidations" ADD COLUMN "refund_method" text;--> statement-breakpoint
ALTER TABLE "moms" ADD COLUMN "document_type" "mom_document_type" DEFAULT 'MoM' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "category_limits" text;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claim_number_unique" UNIQUE("claim_number");