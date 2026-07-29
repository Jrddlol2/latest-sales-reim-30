CREATE TYPE "public"."approval_decision" AS ENUM('Approved', 'Rejected', 'Returned');--> statement-breakpoint
CREATE TYPE "public"."cash_advance_status" AS ENUM('Draft', 'Submitted', 'Approved', 'Rejected', 'Released', 'Liquidated');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('Draft', 'Pending Approval', 'Approved', 'Processing', 'Ready for Claim', 'Completed', 'Rejected', 'Returned');--> statement-breakpoint
CREATE TYPE "public"."delegation_status" AS ENUM('Pending', 'Active', 'Declined', 'Expired', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."field_entity" AS ENUM('mom', 'claim');--> statement-breakpoint
CREATE TYPE "public"."field_input_type" AS ENUM('text', 'number', 'dropdown', 'date', 'textarea');--> statement-breakpoint
CREATE TYPE "public"."liquidation_status" AS ENUM('Draft', 'Submitted', 'ReturnedForRevision', 'Reviewed', 'Closed');--> statement-breakpoint
CREATE TYPE "public"."liquidation_variance_type" AS ENUM('Settled', 'RefundDue', 'ReimbursementDue');--> statement-breakpoint
CREATE TYPE "public"."minutes_source" AS ENUM('Template', 'Uploaded');--> statement-breakpoint
CREATE TYPE "public"."mom_status" AS ENUM('Draft', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."review_meeting_status" AS ENUM('PendingConfirmation', 'Confirmed', 'DeclineRequested', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."support_priority" AS ENUM('Low', 'Medium', 'High');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('Open', 'In Progress', 'Resolved');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('Requestor', 'Approver', 'Custodian', 'Admin');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"approver_id" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approver_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"approver_id" text NOT NULL,
	"delegate_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" "delegation_status" NOT NULL,
	"decline_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_advances" (
	"id" text PRIMARY KEY NOT NULL,
	"requestor_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"purpose" text NOT NULL,
	"mom_id" text,
	"approver_id" text NOT NULL,
	"released_by" text,
	"release_date" timestamp with time zone,
	"release_reference" text,
	"release_method" text,
	"status" "cash_advance_status" NOT NULL,
	"reminder_sent" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_number" text,
	"requestor_id" text NOT NULL,
	"current_approver_id" text NOT NULL,
	"original_approver_id" text,
	"mom_id" text NOT NULL,
	"status" "claim_status" NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"expense_category" text,
	"receipt_url" text,
	"remarks" text,
	"supporting_documents" text,
	"payment_reference" text,
	"payment_method" text,
	"release_code" text,
	"flagged_high_value" boolean DEFAULT false,
	"approved_at" timestamp with time zone,
	"processed_by" text,
	"processing_date" timestamp with time zone,
	"source_liquidation_id" text,
	"import_batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approver_stale_since" timestamp with time zone,
	"pending_transfer_to" text,
	"approver_stale_reason" text,
	"escalated_to_admin" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"notes" text,
	"address" text,
	"business_unit_id" text,
	"cost_center_id" text,
	"default_department_id" text,
	"currency" text,
	"tax_id" text,
	"contact_person" text,
	"contact_email" text,
	"default_approver_id" text,
	CONSTRAINT "companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"expense_date" text NOT NULL,
	"vendor" text NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"business_purpose" text NOT NULL,
	"receipt_url" text,
	"or_number" text
);
--> statement-breakpoint
CREATE TABLE "field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" "field_entity" NOT NULL,
	"applicable_claim_types" text[],
	"key" text NOT NULL,
	"label" text NOT NULL,
	"input_type" "field_input_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"default_value" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"options" text[],
	"master_data_entity" text,
	"allow_other" boolean DEFAULT false,
	"validation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"filename" text NOT NULL,
	"total_records" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "last_seen" (
	"user_id" text NOT NULL,
	"section" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "last_seen_user_id_section_pk" PRIMARY KEY("user_id","section")
);
--> statement-breakpoint
CREATE TABLE "liquidation_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"liquidation_id" text NOT NULL,
	"expense_date" text NOT NULL,
	"vendor" text NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"business_purpose" text NOT NULL,
	"receipt_url" text,
	"attachment_type" text,
	"or_number" text
);
--> statement-breakpoint
CREATE TABLE "liquidations" (
	"id" text PRIMARY KEY NOT NULL,
	"cash_advance_id" text NOT NULL,
	"requestor_id" text NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"variance_type" "liquidation_variance_type" NOT NULL,
	"status" "liquidation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moms" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text,
	"requestor_id" text,
	"client" text,
	"contact_person" text,
	"contact_person_email" text,
	"meeting_date" text NOT NULL,
	"meeting_time" text,
	"location" text,
	"purpose" text,
	"discussion" text,
	"agreements" text,
	"action_items" text,
	"prepared_by" text,
	"prepared_by_department" text,
	"prepared_by_job_title" text,
	"summary" text,
	"file_url" text,
	"file_name" text,
	"status" "mom_status" DEFAULT 'Draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"minutes_source" "minutes_source" DEFAULT 'Template' NOT NULL,
	"meeting_type" text,
	"participants_internal" text,
	"participants_external" text,
	"custom_fields" text
);
--> statement-breakpoint
CREATE TABLE "project_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"requestor_id" text NOT NULL,
	"approver_id" text NOT NULL,
	"meeting_date" text NOT NULL,
	"meeting_time" text NOT NULL,
	"status" "review_meeting_status" NOT NULL,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_histories" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text,
	"cash_advance_id" text,
	"liquidation_id" text,
	"delegation_id" text,
	"user_id" text,
	"master_data_key" text,
	"master_data_id" text,
	"old_status" text NOT NULL,
	"new_status" text NOT NULL,
	"changed_by" text NOT NULL,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_request_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"message" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"requestor_id" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" text,
	"priority" "support_priority" NOT NULL,
	"status" "support_status" NOT NULL,
	"assigned_admin_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"expense_categories" text[] NOT NULL,
	"high_value_threshold" numeric(12, 2) NOT NULL,
	"payment_methods" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"department" text NOT NULL,
	"job_title" text,
	"reports_to" text,
	"employment_status" "employment_status" DEFAULT 'Active',
	"can_approve_reimbursements" boolean DEFAULT false,
	"notification_prefs" text,
	"avatar_url" text,
	"entra_object_id" text,
	"user_principal_name" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_entra_object_id_unique" UNIQUE("entra_object_id"),
	CONSTRAINT "users_user_principal_name_unique" UNIQUE("user_principal_name")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approver_delegations" ADD CONSTRAINT "approver_delegations_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approver_delegations" ADD CONSTRAINT "approver_delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approver_delegations" ADD CONSTRAINT "approver_delegations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_mom_id_moms_id_fk" FOREIGN KEY ("mom_id") REFERENCES "public"."moms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_current_approver_id_users_id_fk" FOREIGN KEY ("current_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_original_approver_id_users_id_fk" FOREIGN KEY ("original_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_mom_id_moms_id_fk" FOREIGN KEY ("mom_id") REFERENCES "public"."moms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_liquidation_id_liquidations_id_fk" FOREIGN KEY ("source_liquidation_id") REFERENCES "public"."liquidations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_pending_transfer_to_users_id_fk" FOREIGN KEY ("pending_transfer_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_default_department_id_departments_id_fk" FOREIGN KEY ("default_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_default_approver_id_users_id_fk" FOREIGN KEY ("default_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "last_seen" ADD CONSTRAINT "last_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidation_line_items" ADD CONSTRAINT "liquidation_line_items_liquidation_id_liquidations_id_fk" FOREIGN KEY ("liquidation_id") REFERENCES "public"."liquidations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidations" ADD CONSTRAINT "liquidations_cash_advance_id_cash_advances_id_fk" FOREIGN KEY ("cash_advance_id") REFERENCES "public"."cash_advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidations" ADD CONSTRAINT "liquidations_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moms" ADD CONSTRAINT "moms_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moms" ADD CONSTRAINT "moms_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_meetings" ADD CONSTRAINT "review_meetings_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_meetings" ADD CONSTRAINT "review_meetings_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_histories" ADD CONSTRAINT "status_histories_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_histories" ADD CONSTRAINT "status_histories_cash_advance_id_cash_advances_id_fk" FOREIGN KEY ("cash_advance_id") REFERENCES "public"."cash_advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_histories" ADD CONSTRAINT "status_histories_liquidation_id_liquidations_id_fk" FOREIGN KEY ("liquidation_id") REFERENCES "public"."liquidations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_histories" ADD CONSTRAINT "status_histories_delegation_id_approver_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."approver_delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_histories" ADD CONSTRAINT "status_histories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request_messages" ADD CONSTRAINT "support_request_messages_request_id_support_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request_messages" ADD CONSTRAINT "support_request_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_assigned_admin_id_users_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reports_to_users_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;