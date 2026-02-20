import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Schema ──────────────────────────────────────────────────────────
export const agentsSchema = pgSchema("agents");

// ─── Enums ───────────────────────────────────────────────────────────

export const triggerTypeEnum = agentsSchema.enum("trigger_type", [
  "EVENT",
  "SCHEDULE",
  "MANUAL",
]);

export const agentTaskPriorityEnum = agentsSchema.enum("agent_task_priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

export const agentTaskStatusEnum = agentsSchema.enum("agent_task_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "NEEDS_REVIEW",
]);

export const ruleTypeEnum = agentsSchema.enum("rule_type", [
  "CLAUSE_RISK",
  "FLOWDOWN",
  "COMPLIANCE",
  "ROUTING",
  "DOCUMENT_GENERATION",
]);

// ─── 8. agent_registry ───────────────────────────────────────────────

export const agentRegistry = agentsSchema.table(
  "agent_registry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentName: varchar("agent_name", { length: 255 }).notNull().unique(),
    agentType: varchar("agent_type", { length: 100 }).notNull(),
    description: text("description"),
    mcpToolIds: text("mcp_tool_ids").array(),
    enabled: boolean("enabled").notNull().default(true),
    configJson: jsonb("config_json").notNull(),
    version: varchar("version", { length: 50 }).notNull(),
    lastDeployedAt: timestamp("last_deployed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_agent_registry_agent_name").on(table.agentName),
    index("idx_agent_registry_agent_type").on(table.agentType),
    index("idx_agent_registry_enabled").on(table.enabled),
  ],
);

// ─── 9. agent_tasks ──────────────────────────────────────────────────

export const agentTasks = agentsSchema.table(
  "agent_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentRegistry.id, { onDelete: "cascade" }),
    triggerType: triggerTypeEnum("trigger_type").notNull(),
    triggerPayload: jsonb("trigger_payload").notNull(),
    priority: agentTaskPriorityEnum("priority").notNull().default("MEDIUM"),
    status: agentTaskStatusEnum("status").notNull().default("QUEUED"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultJson: jsonb("result_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_tasks_agent_id").on(table.agentId),
    index("idx_agent_tasks_status").on(table.status),
    index("idx_agent_tasks_priority").on(table.priority),
  ],
);

// ─── 10. agent_context ───────────────────────────────────────────────

export const agentContext = agentsSchema.table(
  "agent_context",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => agentTasks.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    contextJson: jsonb("context_json").notNull(),
    llmPrompt: text("llm_prompt"),
    llmResponse: text("llm_response"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_agent_context_task_id").on(table.taskId),
  ],
);

// ─── 11. playbook_rules ──────────────────────────────────────────────

export const playbookRules = agentsSchema.table(
  "playbook_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleName: varchar("rule_name", { length: 255 }).notNull(),
    ruleType: ruleTypeEnum("rule_type").notNull(),
    conditionsJson: jsonb("conditions_json").notNull(),
    actionsJson: jsonb("actions_json").notNull(),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: varchar("created_by", { length: 255 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_playbook_rules_rule_type").on(table.ruleType),
    index("idx_playbook_rules_enabled").on(table.enabled),
  ],
);
