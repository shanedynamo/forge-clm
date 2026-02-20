CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA "vectors";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "agents";
--> statement-breakpoint
CREATE TYPE "vectors"."section_type" AS ENUM('SECTION_A', 'SECTION_B', 'SECTION_C', 'SECTION_D', 'SECTION_E', 'SECTION_F', 'SECTION_G', 'SECTION_H', 'SECTION_I', 'SECTION_J', 'SECTION_K', 'SECTION_L', 'SECTION_M', 'PREAMBLE', 'ATTACHMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "audit"."access_type" AS ENUM('READ', 'WRITE', 'DOWNLOAD');--> statement-breakpoint
CREATE TYPE "audit"."agent_exec_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILURE', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "audit"."approval_decision" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "audit"."audit_action" AS ENUM('INSERT', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "agents"."agent_task_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "agents"."agent_task_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "agents"."rule_type" AS ENUM('CLAUSE_RISK', 'FLOWDOWN', 'COMPLIANCE', 'ROUTING', 'DOCUMENT_GENERATION');--> statement-breakpoint
CREATE TYPE "agents"."trigger_type" AS ENUM('EVENT', 'SCHEDULE', 'MANUAL');--> statement-breakpoint
CREATE TABLE "vectors"."clause_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clause_library_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL,
	"version" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vectors"."document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"document_s3_key" varchar(1000) NOT NULL,
	"chunk_index" integer NOT NULL,
	"section_type" "vectors"."section_type" NOT NULL,
	"clause_number" varchar(50),
	"chunk_text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vectors"."entity_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_value" varchar(1000) NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"model_version" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."agent_execution_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"task_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"status" "audit"."agent_exec_status" DEFAULT 'RUNNING' NOT NULL,
	"input_summary" jsonb NOT NULL,
	"output_summary" jsonb,
	"tokens_used" integer,
	"cost_estimate" numeric(10, 4),
	"error_details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."approval_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_queue_id" uuid NOT NULL,
	"approver" varchar(255) NOT NULL,
	"decision" "audit"."approval_decision" NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"ip_address" varchar(45),
	"signature_hash" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"schema_name" varchar(100) NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"record_id" uuid,
	"action" "audit"."audit_action" NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"changed_by" varchar(255) NOT NULL,
	"session_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "audit"."document_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_s3_key" varchar(1000) NOT NULL,
	"accessed_by" varchar(255) NOT NULL,
	"access_type" "audit"."access_type" NOT NULL,
	"purpose" varchar(500),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents"."agent_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"context_json" jsonb NOT NULL,
	"llm_prompt" text,
	"llm_response" text,
	"tokens_used" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents"."agent_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" varchar(255) NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"description" text,
	"mcp_tool_ids" text[],
	"enabled" boolean DEFAULT true NOT NULL,
	"config_json" jsonb NOT NULL,
	"version" varchar(50) NOT NULL,
	"last_deployed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_registry_agent_name_unique" UNIQUE("agent_name")
);
--> statement-breakpoint
CREATE TABLE "agents"."agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"trigger_type" "agents"."trigger_type" NOT NULL,
	"trigger_payload" jsonb NOT NULL,
	"priority" "agents"."agent_task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "agents"."agent_task_status" DEFAULT 'QUEUED' NOT NULL,
	"assigned_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents"."playbook_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_name" varchar(255) NOT NULL,
	"rule_type" "agents"."rule_type" NOT NULL,
	"conditions_json" jsonb NOT NULL,
	"actions_json" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vectors"."clause_embeddings" ADD CONSTRAINT "clause_embeddings_clause_library_id_clause_library_id_fk" FOREIGN KEY ("clause_library_id") REFERENCES "contracts"."clause_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vectors"."document_chunks" ADD CONSTRAINT "document_chunks_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vectors"."entity_annotations" ADD CONSTRAINT "entity_annotations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "vectors"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."approval_audit" ADD CONSTRAINT "approval_audit_approval_queue_id_approval_queue_id_fk" FOREIGN KEY ("approval_queue_id") REFERENCES "contracts"."approval_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_context" ADD CONSTRAINT "agent_context_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "agents"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."agent_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clause_embeddings_clause_library_id" ON "vectors"."clause_embeddings" USING btree ("clause_library_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_contract_id" ON "vectors"."document_chunks" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_section_type" ON "vectors"."document_chunks" USING btree ("section_type");--> statement-breakpoint
CREATE INDEX "idx_entity_annotations_chunk_id" ON "vectors"."entity_annotations" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "idx_entity_annotations_entity_type" ON "vectors"."entity_annotations" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "idx_agent_execution_log_agent_type" ON "audit"."agent_execution_log" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "idx_agent_execution_log_status" ON "audit"."agent_execution_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_execution_log_task_id" ON "audit"."agent_execution_log" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_approval_audit_approval_queue_id" ON "audit"."approval_audit" USING btree ("approval_queue_id");--> statement-breakpoint
CREATE INDEX "idx_approval_audit_approver" ON "audit"."approval_audit" USING btree ("approver");--> statement-breakpoint
CREATE INDEX "idx_audit_log_table_name" ON "audit"."audit_log" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "idx_audit_log_record_id" ON "audit"."audit_log" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_timestamp" ON "audit"."audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "audit"."audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_document_access_log_document_s3_key" ON "audit"."document_access_log" USING btree ("document_s3_key");--> statement-breakpoint
CREATE INDEX "idx_document_access_log_accessed_by" ON "audit"."document_access_log" USING btree ("accessed_by");--> statement-breakpoint
CREATE INDEX "idx_agent_context_task_id" ON "agents"."agent_context" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_registry_agent_name" ON "agents"."agent_registry" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX "idx_agent_registry_agent_type" ON "agents"."agent_registry" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "idx_agent_registry_enabled" ON "agents"."agent_registry" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_agent_tasks_agent_id" ON "agents"."agent_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_tasks_status" ON "agents"."agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_tasks_priority" ON "agents"."agent_tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_playbook_rules_rule_type" ON "agents"."playbook_rules" USING btree ("rule_type");--> statement-breakpoint
CREATE INDEX "idx_playbook_rules_enabled" ON "agents"."playbook_rules" USING btree ("enabled");