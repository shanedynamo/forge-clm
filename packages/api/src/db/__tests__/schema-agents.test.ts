import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { agentRegistry, agentTasks, agentContext, playbookRules } from "../schema-agents.js";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 5 });
  db = drizzle(client);

  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  const migrationsPath = new URL("../migrations", import.meta.url).pathname;
  await migrate(db, { migrationsFolder: migrationsPath });
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
  await db.delete(agentContext);
  await db.delete(agentTasks);
  await db.delete(agentRegistry);
  await db.delete(playbookRules);
});

// ─── Helper: insert an agent ─────────────────────────────────────────

async function insertAgent(overrides: Record<string, unknown> = {}) {
  const [agent] = await db
    .insert(agentRegistry)
    .values({
      agentName: `test-agent-${Date.now()}`,
      agentType: "contract-analyst",
      description: "Analyzes contract documents",
      mcpToolIds: ["tool-read-doc", "tool-extract-clauses"],
      enabled: true,
      configJson: { model: "claude-sonnet-4-6", maxTokens: 4096 },
      version: "1.0.0",
      ...overrides,
    })
    .returning();
  return agent!;
}

// ─── 1. Agent registry CRUD ──────────────────────────────────────────

describe("Agent Registry CRUD", () => {
  it("should create an agent", async () => {
    const agent = await insertAgent();

    expect(agent.id).toBeDefined();
    expect(agent.agentName).toContain("test-agent-");
    expect(agent.agentType).toBe("contract-analyst");
    expect(agent.enabled).toBe(true);
    expect(agent.mcpToolIds).toEqual(["tool-read-doc", "tool-extract-clauses"]);

    const config = agent.configJson as Record<string, unknown>;
    expect(config["model"]).toBe("claude-sonnet-4-6");
  });

  it("should read an agent by ID", async () => {
    const agent = await insertAgent();

    const [fetched] = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.id, agent.id));

    expect(fetched).toBeDefined();
    expect(fetched!.agentName).toBe(agent.agentName);
  });

  it("should update an agent", async () => {
    const agent = await insertAgent();

    await db
      .update(agentRegistry)
      .set({
        version: "2.0.0",
        configJson: { model: "claude-opus-4-6", maxTokens: 8192 },
        lastDeployedAt: new Date(),
      })
      .where(eq(agentRegistry.id, agent.id));

    const [updated] = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.id, agent.id));

    expect(updated!.version).toBe("2.0.0");
    expect(updated!.lastDeployedAt).toBeInstanceOf(Date);

    const config = updated!.configJson as Record<string, unknown>;
    expect(config["model"]).toBe("claude-opus-4-6");
  });

  it("should delete an agent", async () => {
    const agent = await insertAgent();

    await db.delete(agentRegistry).where(eq(agentRegistry.id, agent.id));

    const [deleted] = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.id, agent.id));

    expect(deleted).toBeUndefined();
  });

  it("should enforce unique agent_name constraint", async () => {
    const name = `unique-agent-${Date.now()}`;
    await insertAgent({ agentName: name });

    await expect(insertAgent({ agentName: name })).rejects.toThrow(/unique|duplicate/i);
  });
});

// ─── 2. Agent tasks with status transitions ─────────────────────────

describe("Agent Tasks", () => {
  it("should create a task with QUEUED status and transition through statuses", async () => {
    const agent = await insertAgent();

    // Create task
    const [task] = await db
      .insert(agentTasks)
      .values({
        agentId: agent.id,
        triggerType: "EVENT",
        triggerPayload: { event: "contract.created", contractId: "abc-123" },
        priority: "HIGH",
        status: "QUEUED",
      })
      .returning();

    expect(task).toBeDefined();
    expect(task!.status).toBe("QUEUED");
    expect(task!.priority).toBe("HIGH");

    // Transition to RUNNING
    await db
      .update(agentTasks)
      .set({ status: "RUNNING", assignedAt: new Date() })
      .where(eq(agentTasks.id, task!.id));

    const [running] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, task!.id));
    expect(running!.status).toBe("RUNNING");
    expect(running!.assignedAt).toBeInstanceOf(Date);

    // Transition to COMPLETED
    await db
      .update(agentTasks)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        resultJson: { risk_score: 0.3, recommendation: "APPROVE" },
      })
      .where(eq(agentTasks.id, task!.id));

    const [completed] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, task!.id));
    expect(completed!.status).toBe("COMPLETED");
    expect(completed!.completedAt).toBeInstanceOf(Date);

    const result = completed!.resultJson as Record<string, unknown>;
    expect(result["recommendation"]).toBe("APPROVE");
  });

  it("should support FAILED and NEEDS_REVIEW statuses", async () => {
    const agent = await insertAgent();

    const [failedTask] = await db
      .insert(agentTasks)
      .values({
        agentId: agent.id,
        triggerType: "SCHEDULE",
        triggerPayload: { schedule: "0 9 * * 1" },
        priority: "LOW",
        status: "FAILED",
        resultJson: { error: "Model timeout" },
      })
      .returning();

    expect(failedTask!.status).toBe("FAILED");

    const [reviewTask] = await db
      .insert(agentTasks)
      .values({
        agentId: agent.id,
        triggerType: "MANUAL",
        triggerPayload: { requestedBy: "user@example.com" },
        priority: "URGENT",
        status: "NEEDS_REVIEW",
        resultJson: { confidence: 0.45, flagged_clauses: 7 },
      })
      .returning();

    expect(reviewTask!.status).toBe("NEEDS_REVIEW");
    expect(reviewTask!.priority).toBe("URGENT");
  });

  it("should cascade-delete tasks when agent is deleted", async () => {
    const agent = await insertAgent();

    await db.insert(agentTasks).values({
      agentId: agent.id,
      triggerType: "MANUAL",
      triggerPayload: {},
      status: "QUEUED",
    });

    await db.delete(agentRegistry).where(eq(agentRegistry.id, agent.id));

    const remaining = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.agentId, agent.id));
    expect(remaining).toHaveLength(0);
  });
});

// ─── 3. Agent context linked to a task ───────────────────────────────

describe("Agent Context", () => {
  it("should insert context steps linked to a task", async () => {
    const agent = await insertAgent();

    const [task] = await db
      .insert(agentTasks)
      .values({
        agentId: agent.id,
        triggerType: "EVENT",
        triggerPayload: { contractId: "xyz-789" },
        status: "RUNNING",
        assignedAt: new Date(),
      })
      .returning();

    // Insert multiple context steps
    const steps = await db
      .insert(agentContext)
      .values([
        {
          taskId: task!.id,
          stepNumber: 1,
          contextJson: { action: "read_document", documentKey: "contracts/xyz.pdf" },
          llmPrompt: "Analyze the following contract section...",
          llmResponse: "This section contains a termination for convenience clause...",
          tokensUsed: 850,
        },
        {
          taskId: task!.id,
          stepNumber: 2,
          contextJson: { action: "extract_clauses", count: 15 },
          llmPrompt: "Classify each clause by risk level...",
          llmResponse: "Clause 52.249-2: HIGH risk (T4C)...",
          tokensUsed: 1200,
        },
        {
          taskId: task!.id,
          stepNumber: 3,
          contextJson: { action: "generate_report" },
          tokensUsed: 300,
        },
      ])
      .returning();

    expect(steps).toHaveLength(3);

    // Verify step order
    const step1 = steps.find((s) => s.stepNumber === 1);
    expect(step1!.llmPrompt).toContain("Analyze the following");
    expect(step1!.tokensUsed).toBe(850);

    const step3 = steps.find((s) => s.stepNumber === 3);
    expect(step3!.llmPrompt).toBeNull();
    expect(step3!.llmResponse).toBeNull();

    // Verify cascade: deleting the task removes context
    await db.delete(agentTasks).where(eq(agentTasks.id, task!.id));
    const remaining = await db
      .select()
      .from(agentContext)
      .where(eq(agentContext.taskId, task!.id));
    expect(remaining).toHaveLength(0);
  });
});

// ─── 4. Playbook rules CRUD with JSON conditions/actions ─────────────

describe("Playbook Rules", () => {
  it("should create a playbook rule with JSON conditions and actions", async () => {
    const [rule] = await db
      .insert(playbookRules)
      .values({
        ruleName: "Flag DFARS 252.204-7012",
        ruleType: "CLAUSE_RISK",
        conditionsJson: {
          clause_number: "252.204-7012",
          clause_type: "DFARS",
          contract_type: ["FFP", "CPFF", "T_AND_M"],
        },
        actionsJson: {
          set_risk: "CRITICAL",
          require_flowdown: true,
          notify: ["security-team@example.com"],
          create_milestone: {
            type: "CMMC_ASSESSMENT",
            due_days: 90,
          },
        },
        priority: 100,
        enabled: true,
        createdBy: "admin@forge.gov",
        notes: "Auto-flag CMMC-related clauses for security review",
      })
      .returning();

    expect(rule).toBeDefined();
    expect(rule!.ruleName).toBe("Flag DFARS 252.204-7012");
    expect(rule!.ruleType).toBe("CLAUSE_RISK");
    expect(rule!.priority).toBe(100);

    const conditions = rule!.conditionsJson as Record<string, unknown>;
    expect(conditions["clause_number"]).toBe("252.204-7012");
    expect(conditions["contract_type"]).toEqual(["FFP", "CPFF", "T_AND_M"]);

    const actions = rule!.actionsJson as Record<string, unknown>;
    expect(actions["set_risk"]).toBe("CRITICAL");
    expect(actions["require_flowdown"]).toBe(true);
  });

  it("should update a playbook rule", async () => {
    const [rule] = await db
      .insert(playbookRules)
      .values({
        ruleName: "Route MOU for Legal Review",
        ruleType: "ROUTING",
        conditionsJson: { request_type: "MOU" },
        actionsJson: { route_to: "legal@example.com" },
        priority: 50,
        createdBy: "ops@forge.gov",
      })
      .returning();

    await db
      .update(playbookRules)
      .set({
        actionsJson: { route_to: "legal@example.com", cc: "compliance@example.com" },
        priority: 75,
        notes: "Updated to CC compliance",
      })
      .where(eq(playbookRules.id, rule!.id));

    const [updated] = await db
      .select()
      .from(playbookRules)
      .where(eq(playbookRules.id, rule!.id));

    expect(updated!.priority).toBe(75);
    const actions = updated!.actionsJson as Record<string, unknown>;
    expect(actions["cc"]).toBe("compliance@example.com");
  });

  it("should delete a playbook rule", async () => {
    const [rule] = await db
      .insert(playbookRules)
      .values({
        ruleName: "Temp Rule",
        ruleType: "COMPLIANCE",
        conditionsJson: {},
        actionsJson: {},
        createdBy: "test",
      })
      .returning();

    await db.delete(playbookRules).where(eq(playbookRules.id, rule!.id));

    const [deleted] = await db
      .select()
      .from(playbookRules)
      .where(eq(playbookRules.id, rule!.id));
    expect(deleted).toBeUndefined();
  });

  it("should support all rule types", async () => {
    const ruleTypes = [
      "CLAUSE_RISK",
      "FLOWDOWN",
      "COMPLIANCE",
      "ROUTING",
      "DOCUMENT_GENERATION",
    ] as const;

    for (const ruleType of ruleTypes) {
      const [rule] = await db
        .insert(playbookRules)
        .values({
          ruleName: `Rule for ${ruleType}`,
          ruleType,
          conditionsJson: { type: ruleType },
          actionsJson: { action: "test" },
          createdBy: "test",
        })
        .returning();

      expect(rule!.ruleType).toBe(ruleType);
    }
  });
});

// ─── 5. Disabling an agent reflects correctly ────────────────────────

describe("Agent Enable/Disable", () => {
  it("should correctly reflect disabling an agent in the registry", async () => {
    const agent = await insertAgent({ enabled: true });
    expect(agent.enabled).toBe(true);

    // Disable the agent
    await db
      .update(agentRegistry)
      .set({ enabled: false })
      .where(eq(agentRegistry.id, agent.id));

    const [disabled] = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.id, agent.id));

    expect(disabled!.enabled).toBe(false);

    // Re-enable
    await db
      .update(agentRegistry)
      .set({ enabled: true })
      .where(eq(agentRegistry.id, agent.id));

    const [reenabled] = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.id, agent.id));

    expect(reenabled!.enabled).toBe(true);

    // Query only enabled agents
    await insertAgent({ agentName: "disabled-agent", enabled: false });
    await insertAgent({ agentName: "enabled-agent", enabled: true });

    const enabledAgents = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.enabled, true));

    const enabledNames = enabledAgents.map((a) => a.agentName);
    expect(enabledNames).toContain("enabled-agent");
    expect(enabledNames).not.toContain("disabled-agent");
  });
});
