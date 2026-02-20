import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { AgentRunner, agentExecutionLogTable } from "../agent-runner.js";
import { AgentRegistry, agentRegistryTable } from "../agent-registry.js";
import { TaskQueue, agentTasksTable } from "../task-queue.js";
import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../base-agent.js";

const TEST_DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let registry: AgentRegistry;
let queue: TaskQueue;

const MIGRATIONS_PATH = new URL(
  "../../../../api/src/db/migrations",
  import.meta.url,
).pathname;

// ─── Test agent implementations ──────────────────────────────────────

function mockDeps(): AgentDependencies {
  return {
    llm: { complete: vi.fn().mockResolvedValue("ok") },
    vectorSearch: { search: vi.fn().mockResolvedValue([]) },
    database: {
      query: vi.fn().mockResolvedValue([]),
      getContractContext: vi.fn().mockResolvedValue({
        contractId: "c-1",
        contractNumber: "TEST-001",
        status: "ACTIVE",
        contractType: "FFP",
        ceilingValue: "1000000",
        fundedValue: "500000",
        awardingAgency: "DoD",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
      }),
    },
    audit: { log: vi.fn().mockResolvedValue(undefined) },
    fsm: {
      transition: vi.fn().mockResolvedValue("ACTIVE"),
      getAvailableTransitions: vi.fn().mockResolvedValue([]),
    },
  };
}

class SuccessAgent extends BaseAgent {
  readonly name = "success-agent";
  readonly type = "test";
  readonly description = "Always succeeds";
  async execute(_task: AgentTask): Promise<AgentResult> {
    return { success: true, data: { result: "completed" } };
  }
}

class FailingAgent extends BaseAgent {
  readonly name = "failing-agent";
  readonly type = "test";
  readonly description = "Always throws";
  async execute(_task: AgentTask): Promise<AgentResult> {
    throw new Error("Transient failure");
  }
}

class SlowAgent extends BaseAgent {
  readonly name = "slow-agent";
  readonly type = "test";
  readonly description = "Takes too long";
  async execute(_task: AgentTask): Promise<AgentResult> {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return { success: true };
  }
}

class ReviewAgent extends BaseAgent {
  readonly name = "review-agent";
  readonly type = "test";
  readonly description = "Needs review";
  async execute(_task: AgentTask): Promise<AgentResult> {
    return { success: true, needsReview: true, reviewReason: "Low confidence" };
  }
}

// ─── Setup / Teardown ────────────────────────────────────────────────

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 5 });
  db = drizzle(client);

  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  await migrate(db, { migrationsFolder: MIGRATIONS_PATH });
}, 60_000);

afterAll(async () => {
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");
  await client.end();
});

beforeEach(async () => {
  await client.unsafe("DELETE FROM audit.agent_execution_log");
  await db.delete(agentTasksTable);
  await db.delete(agentRegistryTable);

  registry = new AgentRegistry(db);
  queue = new TaskQueue(db);
});

// ─── Helper ──────────────────────────────────────────────────────────

async function setupAgentAndTask(agent: BaseAgent): Promise<string> {
  await registry.register(agent);
  return queue.enqueue(agent.name, "MANUAL", { test: true }, "HIGH");
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("AgentRunner", () => {
  it("picks up and executes tasks successfully", async () => {
    const agent = new SuccessAgent(mockDeps());
    const taskId = await setupAgentAndTask(agent);
    const task = await queue.dequeue(agent.name);

    const runner = new AgentRunner(registry, queue, db);
    const result = await runner.processTask(task!);

    expect(result.success).toBe(true);
    expect(result.data?.result).toBe("completed");

    // Task should be COMPLETED in DB
    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));
    expect(row!.status).toBe("COMPLETED");
  });

  it("handles agent execution errors gracefully", async () => {
    const agent = new FailingAgent(mockDeps());
    const taskId = await setupAgentAndTask(agent);
    const task = await queue.dequeue(agent.name);

    const runner = new AgentRunner(registry, queue, db, { maxRetries: 0 });
    const result = await runner.processTask(task!);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Transient failure");

    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));
    expect(row!.status).toBe("FAILED");
  });

  it("respects timeout configuration", async () => {
    const agent = new SlowAgent(mockDeps());
    const taskId = await setupAgentAndTask(agent);
    const task = await queue.dequeue(agent.name);

    const runner = new AgentRunner(registry, queue, db, {
      defaultTimeoutMs: 100, // Very short timeout
      maxRetries: 0,
    });

    const result = await runner.processTask(task!);

    expect(result.success).toBe(false);
    expect(result.error).toContain("AGENT_TIMEOUT");
  });

  it("retries on transient failures", async () => {
    const agent = new FailingAgent(mockDeps());
    const taskId = await setupAgentAndTask(agent);
    const task = await queue.dequeue(agent.name);

    const retryEvents: number[] = [];
    const runner = new AgentRunner(registry, queue, db, { maxRetries: 2 });
    runner.on("task:retry", ({ attempt }) => retryEvents.push(attempt));

    const result = await runner.processTask(task!);

    // Should have retried twice before final failure
    expect(retryEvents).toEqual([1, 2]);
    expect(result.success).toBe(false);
  });

  it("logs execution to audit.agent_execution_log", async () => {
    const agent = new SuccessAgent(mockDeps());
    const taskId = await setupAgentAndTask(agent);
    const task = await queue.dequeue(agent.name);

    const runner = new AgentRunner(registry, queue, db);
    await runner.processTask(task!);

    // Check audit log
    const logs = await db
      .select()
      .from(agentExecutionLogTable)
      .where(eq(agentExecutionLogTable.taskId, taskId));

    expect(logs.length).toBe(1);
    expect(logs[0]!.agentType).toBe("test");
    expect(logs[0]!.status).toBe("SUCCESS");
    expect(logs[0]!.startedAt).toBeInstanceOf(Date);
    expect(logs[0]!.completedAt).toBeInstanceOf(Date);
  });

  it("handles needs-review results", async () => {
    const agent = new ReviewAgent(mockDeps());
    const taskId = await setupAgentAndTask(agent);
    const task = await queue.dequeue(agent.name);

    const runner = new AgentRunner(registry, queue, db);
    const result = await runner.processTask(task!);

    expect(result.needsReview).toBe(true);

    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));
    expect(row!.status).toBe("NEEDS_REVIEW");
  });
});
