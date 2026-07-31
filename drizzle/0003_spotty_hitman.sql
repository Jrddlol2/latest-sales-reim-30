ALTER TABLE "claims" ALTER COLUMN "mom_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "claim_type" text DEFAULT 'Reimbursement' NOT NULL;--> statement-breakpoint
ALTER TABLE "moms" ADD COLUMN "cc_client" boolean DEFAULT false NOT NULL;