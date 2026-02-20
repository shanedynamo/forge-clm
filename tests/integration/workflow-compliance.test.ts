/**
 * Integration test: Compliance Monitoring Workflow
 *
 * Seed DB with contracts + deliverables/options/milestones →
 * run compliance monitor → verify findings, Jira tickets, Teams alerts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import {
  ComplianceMonitorAgent,
  ArcadeClient,
} from "@forge/agents";
import {
  connectTestDb,
  setupSchema,
  cleanTables,
  teardownSchema,
  createDbProvider,
  createAuditProvider,
  createMockLlm,
  createMockVectorSearch,
  createMockFsm,
  createTask,
  seedContract,
} from "./helpers.js";

// ─── Fixtures ───────────────────────────────────────────────────────

let client: ReturnType<typeof postgres>;

// Pin "now" to 2026-02-19 for deterministic date calculations
const NOW = new Date("2026-02-19T12:00:00Z");

// ─── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const conn = connectTestDb();
  client = conn.client;
  await setupSchema(client);
}, 120_000);

afterAll(async () => {
  await teardownSchema(client);
});

beforeEach(async () => {
  await cleanTables(client);
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("Compliance Monitoring Workflow", () => {
  it("detects overdue deliverables, approaching options, and funding alerts", async () => {
    // ── Seed contract ────────────────────────────────────────────
    const contractId = await seedContract(client, {
      contract_number: "COMP-TEST-001",
      status: "ACTIVE",
      ceiling_value: "5000000.00",
      funded_value: "4800000.00", // 96% funded → will trigger high-funding alert
      pop_start: "2025-01-01",
      pop_end: "2026-05-19", // 89 days from NOW → POP_EXPIRATION warning
    });

    // Seed overdue deliverable (due 5 days ago)
    await client.unsafe(
      `INSERT INTO contracts.deliverables
       (contract_id, deliverable_type, description, due_date, frequency, recipient, status)
       VALUES ($1, 'Monthly Report', 'February status report', '2026-02-14', 'MONTHLY', 'COR', 'NOT_STARTED')`,
      [contractId],
    );

    // Seed upcoming deliverable (due in 10 days → URGENT)
    await client.unsafe(
      `INSERT INTO contracts.deliverables
       (contract_id, deliverable_type, description, due_date, frequency, recipient, status)
       VALUES ($1, 'CDRL A001', 'Technical data package', '2026-03-01', 'ONE_TIME', 'CO', 'IN_PROGRESS')`,
      [contractId],
    );

    // Seed option approaching deadline (25 days → URGENT)
    await client.unsafe(
      `INSERT INTO contracts.contract_options
       (contract_id, option_number, option_start, option_end, option_value, exercise_deadline, status)
       VALUES ($1, 1, '2026-07-01', '2027-06-30', '1500000.00', '2026-03-16', 'NOT_EXERCISED')`,
      [contractId],
    );

    // Seed overdue compliance milestone (due 3 days ago)
    await client.unsafe(
      `INSERT INTO contracts.compliance_milestones
       (contract_id, milestone_type, description, due_date, recurrence, responsible_party, status)
       VALUES ($1, 'DCAA Audit', 'Annual incurred cost audit', '2026-02-16', 'ANNUALLY', 'Finance Team', 'PENDING')`,
      [contractId],
    );

    // ── Build agent ──────────────────────────────────────────────
    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const fsm = createMockFsm();
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");

    const agent = new ComplianceMonitorAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm,
      },
      { mcp, now: NOW },
    );

    // ── Execute (daily scheduled run — all active contracts) ─────
    const task = createTask(
      "compliance-monitor",
      {},
      { triggerType: "SCHEDULE" },
    );
    const result = await agent.execute(task);

    // ── Verification 1: Agent succeeded with findings ───────────
    expect(result.success).toBe(true);
    expect(result.data?.totalContracts).toBe(1);
    const totalFindings = result.data?.totalFindings as number;
    expect(totalFindings).toBeGreaterThanOrEqual(4); // deliverables + option + milestone + POP/funding

    // ── Verification 2: Overdue deliverable detected ────────────
    const findings = (result.data?.findings as any) as any[];
    const overdueDeliverables = findings.filter(
      (f: any) => f.category === "DELIVERABLE" && f.daysRemaining < 0,
    );
    expect(overdueDeliverables.length).toBeGreaterThanOrEqual(1);
    expect(overdueDeliverables[0].severity).toBe("CRITICAL"); // overdue = <0 days
    expect(overdueDeliverables[0].title).toContain("OVERDUE");

    // Verify DB status updated to OVERDUE
    const overdueRows = await client.unsafe(
      `SELECT status FROM contracts.deliverables
       WHERE contract_id = $1 AND deliverable_type = 'Monthly Report'`,
      [contractId],
    );
    expect((overdueRows[0] as any).status).toBe("OVERDUE");

    // ── Verification 3: Approaching option detected ─────────────
    const optionFindings = findings.filter(
      (f: any) => f.category === "OPTION",
    );
    expect(optionFindings.length).toBe(1);
    expect(optionFindings[0].severity).toBe("URGENT"); // 25 days → ≤30 = URGENT
    expect(optionFindings[0].title).toContain("Option 1");

    // ── Verification 4: Overdue milestone detected ──────────────
    const milestoneFindings = findings.filter(
      (f: any) => f.category === "MILESTONE",
    );
    expect(milestoneFindings.length).toBe(1);
    expect(milestoneFindings[0].severity).toBe("CRITICAL"); // overdue

    // Verify DB status updated to OVERDUE
    const msRows = await client.unsafe(
      `SELECT status FROM contracts.compliance_milestones
       WHERE contract_id = $1 AND milestone_type = 'DCAA Audit'`,
      [contractId],
    );
    expect((msRows[0] as any).status).toBe("OVERDUE");

    // ── Verification 5: POP expiration warning ──────────────────
    const popFindings = findings.filter(
      (f: any) => f.category === "POP_EXPIRATION",
    );
    expect(popFindings.length).toBe(1);
    expect(popFindings[0].daysRemaining).toBe(89);

    // ── Verification 6: Jira tickets created for actionable items
    const jiraCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.createIssue",
    );
    // Actionable findings = URGENT/CRITICAL items
    const actionableCount = findings.filter((f: any) => f.actionRequired).length;
    expect(jiraCalls.length).toBe(actionableCount);

    // Verify Jira call contents
    const jiraSummaries = jiraCalls.map(
      ([, params]) => (params as any).summary as string,
    );
    expect(jiraSummaries.some((s) => s.includes("CRITICAL"))).toBe(true);

    // ── Verification 7: Teams notification for urgent/critical ──
    const teamsCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCalls.length).toBeGreaterThanOrEqual(1);
    const teamsMsg = (teamsCalls[0]![1] as any).message as string;
    expect(teamsMsg).toContain("Compliance Monitor");
    expect(teamsMsg).toContain("urgent/critical");

    // ── Verification 8: Audit log ───────────────────────────────
    const auditRows = await client.unsafe(
      `SELECT * FROM audit.agent_execution_log WHERE task_id = $1 ORDER BY created_at`,
      [task.id],
    );
    expect(auditRows.length).toBe(2);
    expect((auditRows[1] as any).status).toBe("SUCCESS");
  });

  it("runs for a single contract (event-triggered) and finds no issues", async () => {
    // Seed a healthy contract with no upcoming deadlines
    const contractId = await seedContract(client, {
      contract_number: "HEALTHY-001",
      status: "ACTIVE",
      ceiling_value: "1000000.00",
      funded_value: "500000.00", // 50% funded — normal
      pop_start: "2025-01-01",
      pop_end: "2027-12-31", // 680+ days out — no POP warning
    });

    const dbProvider = createDbProvider(client);
    const auditProvider = createAuditProvider(client);
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");

    const agent = new ComplianceMonitorAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: auditProvider,
        fsm: createMockFsm(),
      },
      { mcp, now: NOW },
    );

    const task = createTask("compliance-monitor", {
      contractId,
    });

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data?.totalContracts).toBe(1);

    // Should have no urgent/critical findings that trigger Jira
    const jiraCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.createIssue",
    );
    expect(jiraCalls.length).toBe(0);

    // No Teams notifications
    const teamsCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCalls.length).toBe(0);
  });

  it("sends weekly summary email on scheduled runs", async () => {
    // Seed a contract with one finding
    const contractId = await seedContract(client, {
      contract_number: "WEEKLY-001",
      status: "ACTIVE",
      pop_start: "2025-01-01",
      pop_end: "2026-04-19", // 59 days → WARNING
    });

    const dbProvider = createDbProvider(client);
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");

    const agent = new ComplianceMonitorAgent(
      {
        llm: createMockLlm([]),
        vectorSearch: createMockVectorSearch(),
        database: dbProvider,
        audit: createAuditProvider(client),
        fsm: createMockFsm(),
      },
      { mcp, now: NOW },
    );

    const task = createTask(
      "compliance-monitor",
      {},
      { triggerType: "SCHEDULE" },
    );

    const result = await agent.execute(task);
    expect(result.success).toBe(true);

    // Weekly summary email sent via Outlook
    const emailCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "microsoft.outlook.sendEmail",
    );
    expect(emailCalls.length).toBe(1);
    const emailParams = emailCalls[0]![1] as Record<string, unknown>;
    expect(emailParams.subject).toContain("Weekly Compliance Summary");
    expect(emailParams.body).toContain("Total Findings");
  });
});
