CREATE SCHEMA "contracts";
--> statement-breakpoint
CREATE TYPE "contracts"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "contracts"."business_size" AS ENUM('LARGE', 'SMALL', 'EIGHT_A', 'HUBZONE', 'SDVOSB', 'WOSB', 'EDWOSB');--> statement-breakpoint
CREATE TYPE "contracts"."clause_type" AS ENUM('FAR', 'DFARS', 'AGENCY_SUPPLEMENT');--> statement-breakpoint
CREATE TYPE "contracts"."clin_type" AS ENUM('FFP', 'CPFF', 'T_AND_M', 'COST_PLUS');--> statement-breakpoint
CREATE TYPE "contracts"."comm_channel" AS ENUM('EMAIL', 'TEAMS', 'LETTER', 'PHONE');--> statement-breakpoint
CREATE TYPE "contracts"."comm_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "contracts"."contract_type" AS ENUM('FFP', 'CPFF', 'T_AND_M', 'IDIQ', 'BPA', 'COST_PLUS', 'HYBRID');--> statement-breakpoint
CREATE TYPE "contracts"."deliverable_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "contracts"."flowdown_status" AS ENUM('REQUIRED', 'APPLIED', 'WAIVED');--> statement-breakpoint
CREATE TYPE "contracts"."frequency" AS ENUM('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'AS_NEEDED');--> statement-breakpoint
CREATE TYPE "contracts"."milestone_status" AS ENUM('PENDING', 'COMPLETED', 'OVERDUE', 'WAIVED');--> statement-breakpoint
CREATE TYPE "contracts"."mod_type" AS ENUM('ADMIN', 'FUNDING', 'SCOPE', 'OPTION_EXERCISE', 'TERMINATION', 'NOVATION', 'NAME_CHANGE');--> statement-breakpoint
CREATE TYPE "contracts"."nda_type" AS ENUM('MUTUAL', 'UNILATERAL');--> statement-breakpoint
CREATE TYPE "contracts"."option_status" AS ENUM('NOT_EXERCISED', 'PENDING', 'EXERCISED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "contracts"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "contracts"."property_status" AS ENUM('ACTIVE', 'RETURNED', 'LOST', 'CONSUMED');--> statement-breakpoint
CREATE TYPE "contracts"."property_type" AS ENUM('GFP', 'GFE', 'GFI');--> statement-breakpoint
CREATE TYPE "contracts"."recurrence" AS ENUM('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');--> statement-breakpoint
CREATE TYPE "contracts"."request_type" AS ENUM('NDA', 'MOU', 'NEW_CONTRACT', 'MOD', 'OPTION_EXERCISE', 'FUNDING_ACTION', 'TASK_ASSIGNMENT', 'SUB_MOD');--> statement-breakpoint
CREATE TYPE "contracts"."risk_category" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNASSESSED');--> statement-breakpoint
CREATE TYPE "contracts"."sb_plan_status" AS ENUM('ACTIVE', 'SUBMITTED', 'APPROVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "contracts"."sb_plan_type" AS ENUM('INDIVIDUAL', 'MASTER');--> statement-breakpoint
CREATE TYPE "contracts"."security_level" AS ENUM('UNCLASSIFIED', 'CUI', 'SECRET', 'TOP_SECRET');--> statement-breakpoint
CREATE TABLE "contracts"."approval_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"contract_id" uuid,
	"mod_id" uuid,
	"approver_email" varchar(255) NOT NULL,
	"approval_type" varchar(100) NOT NULL,
	"document_s3_key" varchar(1000),
	"status" "contracts"."approval_status" DEFAULT 'PENDING' NOT NULL,
	"submitted_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"decision_notes" text
);
--> statement-breakpoint
CREATE TABLE "contracts"."clause_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clause_number" varchar(50) NOT NULL,
	"title" varchar(500) NOT NULL,
	"full_text" text NOT NULL,
	"prescription" text,
	"last_updated" date NOT NULL,
	"flowdown_applicability" text,
	"risk_notes" text,
	"source" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clause_library_clause_number_unique" UNIQUE("clause_number")
);
--> statement-breakpoint
CREATE TABLE "contracts"."clins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"clin_number" varchar(50) NOT NULL,
	"description" text,
	"quantity" integer,
	"unit_price" numeric(15, 2),
	"total_value" numeric(15, 2) NOT NULL,
	"clin_type" "contracts"."clin_type" NOT NULL,
	"funded_amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."communications_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid,
	"mod_id" uuid,
	"direction" "contracts"."comm_direction" NOT NULL,
	"channel" "contracts"."comm_channel" NOT NULL,
	"from_party" varchar(255) NOT NULL,
	"to_party" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body_preview" text,
	"s3_key" varchar(1000),
	"received_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."compliance_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"milestone_type" varchar(100) NOT NULL,
	"description" text,
	"due_date" date NOT NULL,
	"recurrence" "contracts"."recurrence" DEFAULT 'ONE_TIME' NOT NULL,
	"responsible_party" varchar(255) NOT NULL,
	"status" "contracts"."milestone_status" DEFAULT 'PENDING' NOT NULL,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."contract_clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"clause_number" varchar(50) NOT NULL,
	"clause_title" varchar(500) NOT NULL,
	"clause_version" varchar(50),
	"clause_type" "contracts"."clause_type" NOT NULL,
	"is_deviation" boolean DEFAULT false NOT NULL,
	"flowdown_required" boolean DEFAULT false NOT NULL,
	"risk_category" "contracts"."risk_category" DEFAULT 'UNASSESSED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."contract_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"option_number" integer NOT NULL,
	"option_start" date NOT NULL,
	"option_end" date NOT NULL,
	"option_value" numeric(15, 2) NOT NULL,
	"exercise_deadline" date NOT NULL,
	"status" "contracts"."option_status" DEFAULT 'NOT_EXERCISED' NOT NULL,
	"notification_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."contract_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" "contracts"."request_type" NOT NULL,
	"requester_name" varchar(255) NOT NULL,
	"requester_email" varchar(255) NOT NULL,
	"priority" "contracts"."priority" DEFAULT 'MEDIUM' NOT NULL,
	"jira_ticket_id" varchar(100),
	"details_json" jsonb,
	"status" varchar(50) DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_number" varchar(100) NOT NULL,
	"contract_type" "contracts"."contract_type" NOT NULL,
	"awarding_agency" varchar(500) NOT NULL,
	"contracting_officer_name" varchar(255) NOT NULL,
	"contracting_officer_email" varchar(255) NOT NULL,
	"cor_name" varchar(255),
	"cor_email" varchar(255),
	"pop_start" date NOT NULL,
	"pop_end" date NOT NULL,
	"ceiling_value" numeric(15, 2) NOT NULL,
	"funded_value" numeric(15, 2) NOT NULL,
	"naics_code" varchar(6),
	"psc_code" varchar(4),
	"security_level" "contracts"."security_level" DEFAULT 'UNCLASSIFIED' NOT NULL,
	"cage_code" varchar(5),
	"duns_uei" varchar(13),
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"description" text,
	"s3_document_key" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_contract_number_unique" UNIQUE("contract_number")
);
--> statement-breakpoint
CREATE TABLE "contracts"."deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"clin_id" uuid,
	"deliverable_type" varchar(100) NOT NULL,
	"description" text,
	"due_date" date,
	"frequency" "contracts"."frequency" DEFAULT 'ONE_TIME' NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"status" "contracts"."deliverable_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"last_submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."flowdown_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prime_clause_id" uuid NOT NULL,
	"sub_contract_id" uuid NOT NULL,
	"flowdown_status" "contracts"."flowdown_status" DEFAULT 'REQUIRED' NOT NULL,
	"applied_date" date,
	"waiver_justification" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."government_property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"property_type" "contracts"."property_type" NOT NULL,
	"description" text NOT NULL,
	"serial_number" varchar(100),
	"acquisition_cost" numeric(15, 2),
	"location" varchar(500) NOT NULL,
	"custodian" varchar(255) NOT NULL,
	"inventory_due_date" date,
	"status" "contracts"."property_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."modifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"mod_number" varchar(50) NOT NULL,
	"mod_type" "contracts"."mod_type" NOT NULL,
	"effective_date" date NOT NULL,
	"description" text,
	"ceiling_delta" numeric(15, 2),
	"funding_delta" numeric(15, 2),
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"sf30_reference" varchar(100),
	"s3_document_key" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."mou_parties" (
	"mou_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" varchar(100) NOT NULL,
	CONSTRAINT "mou_parties_mou_id_party_id_pk" PRIMARY KEY("mou_id","party_id")
);
--> statement-breakpoint
CREATE TABLE "contracts"."mous" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_date" date NOT NULL,
	"expiration_date" date,
	"purpose" text NOT NULL,
	"obligations_summary" text,
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"document_s3_key" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."ndas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_a_id" uuid NOT NULL,
	"party_b_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"expiration_date" date NOT NULL,
	"nda_type" "contracts"."nda_type" NOT NULL,
	"scope_description" text,
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"document_s3_key" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(500) NOT NULL,
	"cage_code" varchar(5),
	"duns_uei" varchar(13),
	"address" text,
	"business_size" "contracts"."business_size",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."small_business_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"plan_type" "contracts"."sb_plan_type" NOT NULL,
	"goal_percentage" numeric(5, 2) NOT NULL,
	"actual_percentage" numeric(5, 2),
	"reporting_period" varchar(50) NOT NULL,
	"status" "contracts"."sb_plan_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_report_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts"."subcontracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prime_contract_id" uuid NOT NULL,
	"subcontractor_name" varchar(500) NOT NULL,
	"subcontractor_cage" varchar(5),
	"sub_type" varchar(100) NOT NULL,
	"ceiling_value" numeric(15, 2) NOT NULL,
	"funded_value" numeric(15, 2) NOT NULL,
	"pop_start" date NOT NULL,
	"pop_end" date NOT NULL,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts"."approval_queue" ADD CONSTRAINT "approval_queue_request_id_contract_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "contracts"."contract_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."approval_queue" ADD CONSTRAINT "approval_queue_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."approval_queue" ADD CONSTRAINT "approval_queue_mod_id_modifications_id_fk" FOREIGN KEY ("mod_id") REFERENCES "contracts"."modifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."clins" ADD CONSTRAINT "clins_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."communications_log" ADD CONSTRAINT "communications_log_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."communications_log" ADD CONSTRAINT "communications_log_mod_id_modifications_id_fk" FOREIGN KEY ("mod_id") REFERENCES "contracts"."modifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."compliance_milestones" ADD CONSTRAINT "compliance_milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."contract_clauses" ADD CONSTRAINT "contract_clauses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."contract_options" ADD CONSTRAINT "contract_options_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."deliverables" ADD CONSTRAINT "deliverables_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."deliverables" ADD CONSTRAINT "deliverables_clin_id_clins_id_fk" FOREIGN KEY ("clin_id") REFERENCES "contracts"."clins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."flowdown_requirements" ADD CONSTRAINT "flowdown_requirements_prime_clause_id_contract_clauses_id_fk" FOREIGN KEY ("prime_clause_id") REFERENCES "contracts"."contract_clauses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."flowdown_requirements" ADD CONSTRAINT "flowdown_requirements_sub_contract_id_subcontracts_id_fk" FOREIGN KEY ("sub_contract_id") REFERENCES "contracts"."subcontracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."government_property" ADD CONSTRAINT "government_property_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."modifications" ADD CONSTRAINT "modifications_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."mou_parties" ADD CONSTRAINT "mou_parties_mou_id_mous_id_fk" FOREIGN KEY ("mou_id") REFERENCES "contracts"."mous"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."mou_parties" ADD CONSTRAINT "mou_parties_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "contracts"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."ndas" ADD CONSTRAINT "ndas_party_a_id_parties_id_fk" FOREIGN KEY ("party_a_id") REFERENCES "contracts"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."ndas" ADD CONSTRAINT "ndas_party_b_id_parties_id_fk" FOREIGN KEY ("party_b_id") REFERENCES "contracts"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."small_business_plans" ADD CONSTRAINT "small_business_plans_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts"."subcontracts" ADD CONSTRAINT "subcontracts_prime_contract_id_contracts_id_fk" FOREIGN KEY ("prime_contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_approval_queue_status" ON "contracts"."approval_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_approval_queue_request_id" ON "contracts"."approval_queue" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_approval_queue_contract_id" ON "contracts"."approval_queue" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_clause_library_clause_number" ON "contracts"."clause_library" USING btree ("clause_number");--> statement-breakpoint
CREATE INDEX "idx_clins_contract_id" ON "contracts"."clins" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_communications_log_contract_id" ON "contracts"."communications_log" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_communications_log_mod_id" ON "contracts"."communications_log" USING btree ("mod_id");--> statement-breakpoint
CREATE INDEX "idx_compliance_milestones_contract_id" ON "contracts"."compliance_milestones" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_compliance_milestones_due_date" ON "contracts"."compliance_milestones" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_compliance_milestones_status" ON "contracts"."compliance_milestones" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contract_clauses_contract_id" ON "contracts"."contract_clauses" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_contract_clauses_clause_number" ON "contracts"."contract_clauses" USING btree ("clause_number");--> statement-breakpoint
CREATE INDEX "idx_contract_options_contract_id" ON "contracts"."contract_options" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_contract_options_exercise_deadline" ON "contracts"."contract_options" USING btree ("exercise_deadline");--> statement-breakpoint
CREATE INDEX "idx_contract_options_status" ON "contracts"."contract_options" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contract_requests_status" ON "contracts"."contract_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contracts_contract_number" ON "contracts"."contracts" USING btree ("contract_number");--> statement-breakpoint
CREATE INDEX "idx_contracts_status" ON "contracts"."contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contracts_naics_code" ON "contracts"."contracts" USING btree ("naics_code");--> statement-breakpoint
CREATE INDEX "idx_contracts_psc_code" ON "contracts"."contracts" USING btree ("psc_code");--> statement-breakpoint
CREATE INDEX "idx_deliverables_contract_id" ON "contracts"."deliverables" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_deliverables_due_date" ON "contracts"."deliverables" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_deliverables_status" ON "contracts"."deliverables" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_government_property_contract_id" ON "contracts"."government_property" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_government_property_status" ON "contracts"."government_property" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_modifications_contract_id" ON "contracts"."modifications" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_modifications_status" ON "contracts"."modifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_mous_status" ON "contracts"."mous" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ndas_status" ON "contracts"."ndas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_small_business_plans_contract_id" ON "contracts"."small_business_plans" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_small_business_plans_status" ON "contracts"."small_business_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_subcontracts_prime_contract_id" ON "contracts"."subcontracts" USING btree ("prime_contract_id");--> statement-breakpoint
CREATE INDEX "idx_subcontracts_status" ON "contracts"."subcontracts" USING btree ("status");