import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  bigserial,
  index,
} from "drizzle-orm/pg-core";
import { approvalQueue } from "./schema";

// ─── Schema ──────────────────────────────────────────────────────────
export const auditSchema = pgSchema("audit");

// ─── Enums ───────────────────────────────────────────────────────────

export const auditActionEnum = auditSchema.enum("audit_action", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

export const agentExecStatusEnum = auditSchema.enum("agent_exec_status", [
  "RUNNING",
  "SUCCESS",
  "FAILURE",
  "NEEDS_REVIEW",
]);

export const accessTypeEnum = auditSchema.enum("access_type", [
  "READ",
  "WRITE",
  "DOWNLOAD",
]);

export const approvalDecisionEnum = auditSchema.enum("approval_decision", [
  "APPROVED",
  "REJECTED",
]);

// ─── 4. audit_log ────────────────────────────────────────────────────

export const auditLog = auditSchema.table(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
    schemaName: varchar("schema_name", { length: 100 }).notNull(),
    tableName: varchar("table_name", { length: 100 }).notNull(),
    recordId: uuid("record_id"),
    action: auditActionEnum("action").notNull(),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    changedBy: varchar("changed_by", { length: 255 }).notNull(),
    sessionId: varchar("session_id", { length: 255 }),
  },
  (table) => [
    index("idx_audit_log_table_name").on(table.tableName),
    index("idx_audit_log_record_id").on(table.recordId),
    index("idx_audit_log_timestamp").on(table.timestamp),
    index("idx_audit_log_action").on(table.action),
  ],
);

// NOTE: The audit trigger function and per-table triggers are created via
// custom SQL in the migration file. The audit_log table is append-only:
// a rule is created to prevent DELETE on audit.audit_log.

// ─── 5. agent_execution_log ──────────────────────────────────────────

export const agentExecutionLog = auditSchema.table(
  "agent_execution_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentType: varchar("agent_type", { length: 100 }).notNull(),
    taskId: uuid("task_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: agentExecStatusEnum("status").notNull().default("RUNNING"),
    inputSummary: jsonb("input_summary").notNull(),
    outputSummary: jsonb("output_summary"),
    tokensUsed: integer("tokens_used"),
    costEstimate: numeric("cost_estimate", { precision: 10, scale: 4 }),
    errorDetails: text("error_details"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_execution_log_agent_type").on(table.agentType),
    index("idx_agent_execution_log_status").on(table.status),
    index("idx_agent_execution_log_task_id").on(table.taskId),
  ],
);

// ─── 6. document_access_log ──────────────────────────────────────────

export const documentAccessLog = auditSchema.table(
  "document_access_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentS3Key: varchar("document_s3_key", { length: 1000 }).notNull(),
    accessedBy: varchar("accessed_by", { length: 255 }).notNull(),
    accessType: accessTypeEnum("access_type").notNull(),
    purpose: varchar("purpose", { length: 500 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_document_access_log_document_s3_key").on(table.documentS3Key),
    index("idx_document_access_log_accessed_by").on(table.accessedBy),
  ],
);

// ─── 7. approval_audit ───────────────────────────────────────────────

export const approvalAudit = auditSchema.table(
  "approval_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    approvalQueueId: uuid("approval_queue_id")
      .notNull()
      .references(() => approvalQueue.id),
    approver: varchar("approver", { length: 255 }).notNull(),
    decision: approvalDecisionEnum("decision").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    signatureHash: varchar("signature_hash", { length: 255 }),
  },
  (table) => [
    index("idx_approval_audit_approval_queue_id").on(table.approvalQueueId),
    index("idx_approval_audit_approver").on(table.approver),
  ],
);
