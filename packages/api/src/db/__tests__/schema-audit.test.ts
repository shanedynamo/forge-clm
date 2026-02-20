import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql, desc } from "drizzle-orm";
import postgres from "postgres";
import { contracts, approvalQueue, contractRequests } from "../schema.js";
import { auditLog, agentExecutionLog, approvalAudit } from "../schema-audit.js";

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
  // Clear audit tables first, then contracts data
  // Use replica role to skip audit triggers during cleanup
  await client.unsafe("SET session_replication_role = 'replica'");
  await db.delete(approvalAudit);
  await db.delete(agentExecutionLog);
  await client.unsafe("DELETE FROM audit.audit_log");
  await db.delete(approvalQueue);
  await db.delete(contractRequests);
  await db.delete(contracts);
  await client.unsafe("SET session_replication_role = 'origin'");
});

// ─── Helper: insert a contract ───────────────────────────────────────

async function insertContract(overrides: Record<string, unknown> = {}) {
  const [c] = await db
    .insert(contracts)
    .values({
      contractNumber: `AUDIT-${Date.now()}`,
      contractType: "FFP",
      awardingAgency: "US Navy",
      contractingOfficerName: "Bob Jones",
      contractingOfficerEmail: "bob@navy.mil",
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
      ceilingValue: "3000000.00",
      fundedValue: "1500000.00",
      status: "ACTIVE",
      ...overrides,
    })
    .returning();
  return c!;
}

// ─── 1. Inserting a contract auto-creates an audit_log entry ─────────

describe("Audit Trigger — INSERT", () => {
  it("should automatically create an audit_log entry when a contract is inserted", async () => {
    const contract = await insertContract();

    // Query audit_log for the INSERT
    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.recordId, contract.id));

    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log.schemaName).toBe("contracts");
    expect(log.tableName).toBe("contracts");
    expect(log.action).toBe("INSERT");
    expect(log.oldValues).toBeNull();
    expect(log.newValues).toBeDefined();

    const newVals = log.newValues as Record<string, unknown>;
    expect(newVals["contract_number"]).toBe(contract.contractNumber);
    expect(log.changedBy).toBe("system");
  });
});

// ─── 2. Updating a contract creates an audit_log with old + new ─────

describe("Audit Trigger — UPDATE", () => {
  it("should create an audit_log entry with old and new values on update", async () => {
    const contract = await insertContract();

    // Update the contract status
    await db
      .update(contracts)
      .set({ status: "IN_REVIEW", description: "Updated for review" })
      .where(eq(contracts.id, contract.id));

    // Should have 2 audit entries: one INSERT, one UPDATE
    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.recordId, contract.id))
      .orderBy(auditLog.id);

    expect(logs.length).toBeGreaterThanOrEqual(2);

    const updateLog = logs.find((l) => l.action === "UPDATE");
    expect(updateLog).toBeDefined();
    expect(updateLog!.oldValues).toBeDefined();
    expect(updateLog!.newValues).toBeDefined();

    const oldVals = updateLog!.oldValues as Record<string, unknown>;
    const newVals = updateLog!.newValues as Record<string, unknown>;

    expect(oldVals["status"]).toBe("ACTIVE");
    expect(newVals["status"]).toBe("IN_REVIEW");
    expect(newVals["description"]).toBe("Updated for review");
  });
});

// ─── 3. Audit_log rejects direct DELETE operations ───────────────────

describe("Audit Log — Append-Only", () => {
  it("should reject direct DELETE operations on audit_log", async () => {
    // Insert a contract to generate an audit entry
    await insertContract();

    // Verify there's at least one entry
    const countBefore = await db.select({ count: sql<number>`count(*)` }).from(auditLog);
    expect(Number(countBefore[0]!.count)).toBeGreaterThan(0);

    // Attempt to delete — the RULE should silently prevent it (DO INSTEAD NOTHING)
    await client.unsafe("DELETE FROM audit.audit_log");

    // Verify records still exist
    const countAfter = await db.select({ count: sql<number>`count(*)` }).from(auditLog);
    expect(Number(countAfter[0]!.count)).toBe(Number(countBefore[0]!.count));
  });
});

// ─── 4. Agent execution log insert and status transitions ────────────

describe("Agent Execution Log", () => {
  it("should insert and update agent execution log entries", async () => {
    // Insert a RUNNING execution
    const [exec] = await db
      .insert(agentExecutionLog)
      .values({
        agentType: "contract-analyst",
        taskId: "00000000-0000-0000-0000-000000000001",
        startedAt: new Date(),
        status: "RUNNING",
        inputSummary: { contractId: "test-123", action: "analyze" },
        tokensUsed: 0,
      })
      .returning();

    expect(exec).toBeDefined();
    expect(exec!.status).toBe("RUNNING");

    // Transition to SUCCESS
    await db
      .update(agentExecutionLog)
      .set({
        status: "SUCCESS",
        completedAt: new Date(),
        outputSummary: { risk_score: 0.42, clauses_flagged: 3 },
        tokensUsed: 1500,
        costEstimate: "0.0045",
      })
      .where(eq(agentExecutionLog.id, exec!.id));

    const [updated] = await db
      .select()
      .from(agentExecutionLog)
      .where(eq(agentExecutionLog.id, exec!.id));

    expect(updated!.status).toBe("SUCCESS");
    expect(updated!.completedAt).toBeInstanceOf(Date);
    expect(updated!.tokensUsed).toBe(1500);
    expect(updated!.costEstimate).toBe("0.0045");

    const output = updated!.outputSummary as Record<string, unknown>;
    expect(output["risk_score"]).toBe(0.42);
  });

  it("should support FAILURE status with error details", async () => {
    const [exec] = await db
      .insert(agentExecutionLog)
      .values({
        agentType: "compliance-checker",
        taskId: "00000000-0000-0000-0000-000000000002",
        startedAt: new Date(),
        status: "RUNNING",
        inputSummary: { contractId: "test-456" },
      })
      .returning();

    await db
      .update(agentExecutionLog)
      .set({
        status: "FAILURE",
        completedAt: new Date(),
        errorDetails: "TimeoutError: LLM request exceeded 30s limit",
      })
      .where(eq(agentExecutionLog.id, exec!.id));

    const [failed] = await db
      .select()
      .from(agentExecutionLog)
      .where(eq(agentExecutionLog.id, exec!.id));

    expect(failed!.status).toBe("FAILURE");
    expect(failed!.errorDetails).toContain("TimeoutError");
  });
});

// ─── 5. Approval audit insert ────────────────────────────────────────

describe("Approval Audit", () => {
  it("should insert an approval audit entry linked to an approval queue item", async () => {
    // Create a contract request and approval queue entry
    const [request] = await db
      .insert(contractRequests)
      .values({
        requestType: "NEW_CONTRACT",
        requesterName: "Alice",
        requesterEmail: "alice@example.com",
        priority: "HIGH",
        status: "PENDING_REVIEW",
      })
      .returning();

    const [approval] = await db
      .insert(approvalQueue)
      .values({
        requestId: request!.id,
        approverEmail: "manager@example.com",
        approvalType: "CONTRACT_INITIATION",
        status: "PENDING",
        submittedAt: new Date(),
      })
      .returning();

    // Record the approval decision in the audit
    const [auditEntry] = await db
      .insert(approvalAudit)
      .values({
        approvalQueueId: approval!.id,
        approver: "manager@example.com",
        decision: "APPROVED",
        timestamp: new Date(),
        ipAddress: "192.168.1.100",
        signatureHash: "sha256:abc123def456",
      })
      .returning();

    expect(auditEntry).toBeDefined();
    expect(auditEntry!.approvalQueueId).toBe(approval!.id);
    expect(auditEntry!.decision).toBe("APPROVED");
    expect(auditEntry!.ipAddress).toBe("192.168.1.100");
    expect(auditEntry!.signatureHash).toBe("sha256:abc123def456");
  });
});
