ALTER TABLE "cash_advances" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD COLUMN "paid_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "approved_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "paid_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "paid_at" timestamp with time zone;