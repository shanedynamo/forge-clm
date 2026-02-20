import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { TaskQueue } from "../task-queue.js";
import { agentRegistryTable } from "../agent-registry.js";
import { agentTasksTable } from "../task-queue.js";

const TEST_DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let queue: TaskQueue;

// We need the migrations from the API package
const MIGRATIONS_PATH = new URL(
  "../../../../api/src/db/migrations",
  import.meta.url,
).pathname;

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

  queue = new TaskQueue(db);
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
  await db.delete(agentTasksTable);
  await db.delete(agentRegistryTable);
});

// ─── Helper: create an agent in the registry ─────────────────────────

async function createAgent(name: string = "test-agent") {
  const [agent] = await db
    .insert(agentRegistryTable)
    .values({
      agentName: name,
      agentType: "test",
      description: "Test agent",
      enabled: true,
      configJson: {},
      version: "1.0.0",
    })
    .returning();
  return agent!;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("TaskQueue", () => {
  it("enqueue creates a task in the database", async () => {
    await createAgent("enqueue-agent");

    const taskId = await queue.enqueue(
      "enqueue-agent",
      "EVENT",
      { contractId: "c-123", event: "contract.created" },
      "HIGH",
    );

    expect(taskId).toBeDefined();

    // Verify it's in the DB
    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));

    expect(row).toBeDefined();
    expect(row!.status).toBe("QUEUED");
    expect(row!.priority).toBe("HIGH");
    expect(row!.triggerType).toBe("EVENT");
  });

  it("dequeue returns highest priority task first", async () => {
    await createAgent("priority-agent");

    // Enqueue LOW, HIGH, MEDIUM, URGENT
    await queue.enqueue("priority-agent", "MANUAL", { order: 1 }, "LOW");
    await queue.enqueue("priority-agent", "MANUAL", { order: 2 }, "HIGH");
    await queue.enqueue("priority-agent", "MANUAL", { order: 3 }, "MEDIUM");
    await queue.enqueue("priority-agent", "MANUAL", { order: 4 }, "URGENT");

    // Dequeue should return URGENT first
    const first = await queue.dequeue("priority-agent");
    expect(first).not.toBeNull();
    expect(first!.priority).toBe("URGENT");
    expect((first!.triggerPayload as any).order).toBe(4);

    // Then HIGH
    const second = await queue.dequeue("priority-agent");
    expect(second!.priority).toBe("HIGH");

    // Then MEDIUM
    const third = await queue.dequeue("priority-agent");
    expect(third!.priority).toBe("MEDIUM");

    // Then LOW
    const fourth = await queue.dequeue("priority-agent");
    expect(fourth!.priority).toBe("LOW");
  });

  it("dequeue returns null when queue is empty", async () => {
    await createAgent("empty-agent");

    const task = await queue.dequeue("empty-agent");
    expect(task).toBeNull();
  });

  it("complete updates task status to COMPLETED", async () => {
    await createAgent("complete-agent");
    const taskId = await queue.enqueue("complete-agent", "MANUAL", { test: true });

    // Dequeue first (sets to RUNNING)
    await queue.dequeue("complete-agent");

    // Complete
    await queue.complete(taskId, { result: "done", score: 0.95 });

    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));

    expect(row!.status).toBe("COMPLETED");
    expect(row!.completedAt).toBeDefined();
    expect((row!.resultJson as any).result).toBe("done");
  });

  it("fail updates task status to FAILED", async () => {
    await createAgent("fail-agent");
    const taskId = await queue.enqueue("fail-agent", "EVENT", { test: true });

    await queue.dequeue("fail-agent");
    await queue.fail(taskId, "Connection timeout");

    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));

    expect(row!.status).toBe("FAILED");
    expect((row!.resultJson as any).error).toBe("Connection timeout");
  });

  it("markForReview sets NEEDS_REVIEW status", async () => {
    await createAgent("review-agent");
    const taskId = await queue.enqueue("review-agent", "EVENT", { test: true });

    await queue.dequeue("review-agent");
    await queue.markForReview(taskId, "Low confidence score");

    const [row] = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId));

    expect(row!.status).toBe("NEEDS_REVIEW");
    expect((row!.resultJson as any).reviewReason).toBe("Low confidence score");
  });
});
