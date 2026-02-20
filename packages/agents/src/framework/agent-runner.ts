/**
 * Agent runner — polls the task queue and executes agents.
 *
 * Handles timeouts, retries, audit logging, and event emission.
 */

import { EventEmitter } from "node:events";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { pgSchema, uuid, varchar, text, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { AgentRegistry } from "./agent-registry.js";
import type { TaskQueue, QueuedTask } from "./task-queue.js";
import type { AgentTask, AgentResult } from "./base-agent.js";

// Mirror audit.agent_execution_log table
const auditSchema = pgSchema("audit");

const agentExecStatusEnum = auditSchema.enum("agent_exec_status", [
  "RUNNING",
  "SUCCESS",
  "FAILURE",
  "NEEDS_REVIEW",
]);

export const agentExecutionLogTable = auditSchema.table("agent_execution_log", {
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
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

// ─── Configuration ───────────────────────────────────────────────────

export interface RunnerConfig {
  pollIntervalMs?: number;
  defaultTimeoutMs?: number;
  maxRetries?: number;
  agentTimeouts?: Record<string, number>;
}

const DEFAULT_CONFIG: Required<RunnerConfig> = {
  pollIntervalMs: 5000,
  defaultTimeoutMs: 30_000,
  maxRetries: 2,
  agentTimeouts: {},
};

// ─── Events ──────────────────────────────────────────────────────────

export interface RunnerEvents {
  "task:started": { taskId: string; agentName: string };
  "task:completed": { taskId: string; agentName: string; result: AgentResult };
  "task:failed": { taskId: string; agentName: string; error: string };
  "task:timeout": { taskId: string; agentName: string };
  "task:retry": { taskId: string; agentName: string; attempt: number };
}

// ─── AgentRunner class ───────────────────────────────────────────────

export class AgentRunner extends EventEmitter {
  private config: Required<RunnerConfig>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly queue: TaskQueue,
    private readonly db: AnyDb,
    config?: RunnerConfig,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start polling the task queue.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  /**
   * Stop polling.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Process a single task (for testing or manual invocation).
   */
  async processTask(task: QueuedTask): Promise<AgentResult> {
    const agent = this.registry.get(task.agentName);
    const timeoutMs =
      this.config.agentTimeouts[task.agentName] ?? this.config.defaultTimeoutMs;

    const agentTask: AgentTask = {
      id: task.id,
      agentName: task.agentName,
      triggerType: task.triggerType,
      triggerPayload: task.triggerPayload,
      priority: task.priority,
      createdAt: task.createdAt,
    };

    // Log execution start
    const startedAt = new Date();
    const [execLog] = await this.db
      .insert(agentExecutionLogTable)
      .values({
        agentType: agent.type,
        taskId: task.id,
        startedAt,
        status: "RUNNING",
        inputSummary: task.triggerPayload,
      })
      .returning();

    this.emit("task:started", { taskId: task.id, agentName: task.agentName });

    let result: AgentResult;
    let attempt = 0;

    while (attempt <= this.config.maxRetries) {
      try {
        // Execute with timeout
        result = await this.executeWithTimeout(agent.execute.bind(agent), agentTask, timeoutMs);

        if (result.needsReview) {
          await this.queue.markForReview(task.id, result.reviewReason ?? "Agent flagged for review");
          await this.updateExecLog(execLog!.id, "NEEDS_REVIEW", result, startedAt);
        } else if (result.success) {
          await this.queue.complete(task.id, result.data ?? {});
          await this.updateExecLog(execLog!.id, "SUCCESS", result, startedAt);
        } else {
          await this.queue.fail(task.id, result.error ?? "Unknown error");
          await this.updateExecLog(execLog!.id, "FAILURE", result, startedAt, result.error);
        }

        this.emit("task:completed", { taskId: task.id, agentName: task.agentName, result });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const isTimeout = errorMessage === "AGENT_TIMEOUT";

        if (isTimeout) {
          this.emit("task:timeout", { taskId: task.id, agentName: task.agentName });
        }

        if (attempt < this.config.maxRetries) {
          attempt++;
          this.emit("task:retry", { taskId: task.id, agentName: task.agentName, attempt });
          continue;
        }

        // Final failure
        result = { success: false, error: errorMessage };
        await this.queue.fail(task.id, errorMessage);
        await this.updateExecLog(execLog!.id, "FAILURE", result, startedAt, errorMessage);

        this.emit("task:failed", { taskId: task.id, agentName: task.agentName, error: errorMessage });
        return result;
      }
    }

    // Should not reach here, but TypeScript needs it
    return { success: false, error: "Max retries exceeded" };
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      const enabledAgents = await this.registry.listEnabled();

      for (const agent of enabledAgents) {
        const task = await this.queue.dequeue(agent.name);
        if (task) {
          // Fire and forget — don't block the poll loop
          this.processTask(task).catch((err) => {
            this.emit("task:failed", {
              taskId: task.id,
              agentName: task.agentName,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    } catch {
      // Polling errors should not crash the runner
    }
  }

  private async executeWithTimeout(
    fn: (task: AgentTask) => Promise<AgentResult>,
    task: AgentTask,
    timeoutMs: number,
  ): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("AGENT_TIMEOUT"));
      }, timeoutMs);

      fn(task)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private async updateExecLog(
    logId: string,
    status: "SUCCESS" | "FAILURE" | "NEEDS_REVIEW",
    result: AgentResult,
    startedAt: Date,
    errorDetails?: string,
  ): Promise<void> {
    await this.db
      .update(agentExecutionLogTable)
      .set({
        status,
        completedAt: new Date(),
        outputSummary: result.data ?? {},
        errorDetails: errorDetails ?? null,
      })
      .where(sql`id = ${logId}`);
  }
}
