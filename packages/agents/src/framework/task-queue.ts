/**
 * Task queue — backed by the agents.agent_tasks database table.
 *
 * Manages the lifecycle of agent tasks: enqueue, dequeue, complete, fail.
 */

import { eq, and, sql, asc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  pgSchema,
  uuid,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { agentRegistryTable } from "./agent-registry.js";

// Mirror the agents.agent_tasks table
const agentsSchema = pgSchema("agents");

const triggerTypeEnum = agentsSchema.enum("trigger_type", [
  "EVENT",
  "SCHEDULE",
  "MANUAL",
]);

const agentTaskPriorityEnum = agentsSchema.enum("agent_task_priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

const agentTaskStatusEnum = agentsSchema.enum("agent_task_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "NEEDS_REVIEW",
]);

export const agentTasksTable = agentsSchema.table("agent_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agentRegistryTable.id, { onDelete: "cascade" }),
  triggerType: triggerTypeEnum("trigger_type").notNull(),
  triggerPayload: jsonb("trigger_payload").notNull(),
  priority: agentTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: agentTaskStatusEnum("status").notNull().default("QUEUED"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resultJson: jsonb("result_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Types ───────────────────────────────────────────────────────────

export type TriggerType = "EVENT" | "SCHEDULE" | "MANUAL";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW";

export interface QueuedTask {
  id: string;
  agentId: string;
  agentName: string;
  triggerType: TriggerType;
  triggerPayload: Record<string, unknown>;
  priority: Priority;
  status: TaskStatus;
  createdAt: Date;
}

// Priority ordering for dequeue (URGENT > HIGH > MEDIUM > LOW)
const PRIORITY_ORDER = `CASE priority
  WHEN 'URGENT' THEN 0
  WHEN 'HIGH' THEN 1
  WHEN 'MEDIUM' THEN 2
  WHEN 'LOW' THEN 3
  ELSE 4
END`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

// ─── TaskQueue class ─────────────────────────────────────────────────

export class TaskQueue {
  constructor(private readonly db: AnyDb) {}

  /**
   * Enqueue a new task for an agent.
   */
  async enqueue(
    agentName: string,
    trigger: TriggerType,
    payload: Record<string, unknown>,
    priority: Priority = "MEDIUM",
  ): Promise<string> {
    // Look up agent ID by name
    const [agent] = await this.db
      .select({ id: agentRegistryTable.id })
      .from(agentRegistryTable)
      .where(eq(agentRegistryTable.agentName, agentName));

    if (!agent) {
      throw new Error(`Agent "${agentName}" not found in registry`);
    }

    const [task] = await this.db
      .insert(agentTasksTable)
      .values({
        agentId: agent.id,
        triggerType: trigger,
        triggerPayload: payload,
        priority,
        status: "QUEUED",
      })
      .returning();

    return task!.id;
  }

  /**
   * Dequeue the highest-priority QUEUED task for an agent.
   * Atomically sets status to RUNNING.
   * Returns null if no tasks are available.
   */
  async dequeue(agentName: string): Promise<QueuedTask | null> {
    // Look up agent ID
    const [agent] = await this.db
      .select({ id: agentRegistryTable.id })
      .from(agentRegistryTable)
      .where(eq(agentRegistryTable.agentName, agentName));

    if (!agent) {
      throw new Error(`Agent "${agentName}" not found in registry`);
    }

    // Find the highest-priority QUEUED task and claim it atomically
    const result = await (this.db as any).execute(sql.raw(`
      UPDATE agents.agent_tasks
      SET status = 'RUNNING', assigned_at = NOW()
      WHERE id = (
        SELECT id FROM agents.agent_tasks
        WHERE agent_id = '${agent.id}'
          AND status = 'QUEUED'
        ORDER BY ${PRIORITY_ORDER}, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, agent_id AS "agentId", trigger_type AS "triggerType",
                trigger_payload AS "triggerPayload", priority, status,
                created_at AS "createdAt"
    `));

    const rows = result.rows ?? result;
    if (rows.length === 0) return null;

    const row = rows[0] as any;
    return {
      id: row.id,
      agentId: row.agentId,
      agentName,
      triggerType: row.triggerType,
      triggerPayload: typeof row.triggerPayload === "string"
        ? JSON.parse(row.triggerPayload)
        : row.triggerPayload,
      priority: row.priority,
      status: "RUNNING",
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    };
  }

  /**
   * Mark a task as completed with results.
   */
  async complete(taskId: string, result: Record<string, unknown>): Promise<void> {
    await this.db
      .update(agentTasksTable)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        resultJson: result,
      })
      .where(eq(agentTasksTable.id, taskId));
  }

  /**
   * Mark a task as failed.
   */
  async fail(taskId: string, error: string): Promise<void> {
    await this.db
      .update(agentTasksTable)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        resultJson: { error },
      })
      .where(eq(agentTasksTable.id, taskId));
  }

  /**
   * Mark a task for human review.
   */
  async markForReview(taskId: string, reason: string): Promise<void> {
    await this.db
      .update(agentTasksTable)
      .set({
        status: "NEEDS_REVIEW",
        resultJson: { reviewReason: reason },
      })
      .where(eq(agentTasksTable.id, taskId));
  }
}
