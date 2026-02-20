import { describe, it, expect, vi } from "vitest";
import {
  ComplianceMonitorAgent,
  type ComplianceFinding,
} from "../compliance-monitor.js";
import {
  FundingCalculator,
  type ContractFundingData,
} from "../helpers/funding-calculator.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";
import type { AgentTask, AgentDependencies } from "../../framework/base-agent.js";

// ─── Fixed "now" for deterministic tests ─────────────────────────────

const NOW = new Date("2024-07-15T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function futureDate(days: number): string {
  return new Date(NOW.getTime() + days * MS_PER_DAY).toISOString().split("T")[0]!;
}

function pastDate(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString().split("T")[0]!;
}

// ─── Seed data builders ──────────────────────────────────────────────

function makeContract(overrides?: Record<string, unknown>) {
  return {
    id: "contract-001",
    contract_number: "FA8726-24-C-0042",
    contract_type: "CPFF",
    awarding_agency: "USAF",
    contracting_officer_name: "Jane Smith",
    contracting_officer_email: "jane@agency.gov",
    pop_start: "2024-01-01",
    pop_end: "2025-12-31",
    ceiling_value: "10000000.00",
    funded_value: "5000000.00",
    status: "ACTIVE",
    ...overrides,
  };
}

// ─── Mock deps builder ───────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface MockDepsOptions {
  contracts?: any[];
  deliverables?: any[];
  options?: any[];
  milestones?: any[];
  property?: any[];
  existingJiraTickets?: any[];
}

function createMockDeps(opts?: MockDepsOptions): AgentDependencies & { queryCalls: QueryCall[] } {
  const queryCalls: QueryCall[] = [];
  const contracts = opts?.contracts ?? [makeContract()];
  const deliverables = opts?.deliverables ?? [];
  const optionRows = opts?.options ?? [];
  const milestones = opts?.milestones ?? [];
  const property = opts?.property ?? [];
  const existingTickets = opts?.existingJiraTickets ?? [];

  const queryFn = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    queryCalls.push({ sql, params });

    if (sql.includes("FROM contracts.contracts") && sql.includes("status = 'ACTIVE'")) {
      return contracts;
    }
    if (sql.includes("FROM contracts.contracts") && sql.includes("id = $1")) {
      return contracts.filter((c: any) => c.id === params[0]);
    }
    if (sql.includes("FROM contracts.deliverables")) return deliverables;
    if (sql.includes("FROM contracts.contract_options")) return optionRows;
    if (sql.includes("FROM contracts.compliance_milestones")) return milestones;
    if (sql.includes("FROM contracts.government_property")) return property;
    if (sql.includes("FROM contracts.contract_requests") && sql.includes("jira_ticket_id")) {
      return existingTickets;
    }
    if (sql.includes("UPDATE")) return [];
    return [];
  });

  return {
    queryCalls,
    llm: { complete: vi.fn().mockResolvedValue("ok") },
    vectorSearch: { search: vi.fn().mockResolvedValue([]) },
    database: {
      query: queryFn,
      getContractContext: vi.fn().mockResolvedValue({
        contractId: "contract-001",
        contractNumber: "FA8726-24-C-0042",
        status: "ACTIVE",
        contractType: "CPFF",
        ceilingValue: "10000000.00",
        fundedValue: "5000000.00",
        awardingAgency: "USAF",
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

function createTask(overrides?: Record<string, unknown>): AgentTask {
  return {
    id: "task-compliance-001",
    agentName: "compliance-monitor",
    triggerType: "SCHEDULE",
    triggerPayload: overrides ?? {},
    priority: "MEDIUM",
    createdAt: NOW,
  };
}

function buildAgent(deps: AgentDependencies, mcp?: ArcadeClient) {
  return new ComplianceMonitorAgent(deps, {
    mcp: mcp ?? new ArcadeClient({ mode: "mock" }),
    now: NOW,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("ComplianceMonitorAgent", () => {
  // ─── Deliverable tests ─────────────────────────────────────────────

  it("generates urgent alert for deliverable due in 7 days", async () => {
    const deps = createMockDeps({
      deliverables: [
        {
          id: "del-1",
          deliverable_type: "Monthly Status Report",
          description: "Monthly status report for July",
          due_date: futureDate(5),
          status: "IN_PROGRESS",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const delFinding = findings.find((f) => f.category === "DELIVERABLE");
    expect(delFinding).toBeDefined();
    expect(delFinding!.severity).toBe("URGENT");
    expect(delFinding!.daysRemaining).toBe(5);
    expect(delFinding!.title).toContain("Upcoming Deliverable");
  });

  it("flags overdue deliverable and updates status", async () => {
    const deps = createMockDeps({
      deliverables: [
        {
          id: "del-2",
          deliverable_type: "CDRL A001",
          description: "Technical data package",
          due_date: pastDate(3),
          status: "IN_PROGRESS",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const overdueFinding = findings.find(
      (f) => f.category === "DELIVERABLE" && f.severity === "CRITICAL",
    );
    expect(overdueFinding).toBeDefined();
    expect(overdueFinding!.title).toContain("OVERDUE");

    // Verify status was updated to OVERDUE
    const updateCall = deps.queryCalls.find(
      (c) => c.sql.includes("UPDATE contracts.deliverables") && c.sql.includes("OVERDUE"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.params[0]).toBe("del-2");
  });

  // ─── Option tests ─────────────────────────────────────────────────

  it("generates info alert for option at 90 days", async () => {
    const deps = createMockDeps({
      options: [
        {
          id: "opt-1",
          option_number: 2,
          option_start: "2025-01-01",
          option_end: "2025-12-31",
          option_value: "2500000.00",
          exercise_deadline: futureDate(85),
          status: "NOT_EXERCISED",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const optFinding = findings.find((f) => f.category === "OPTION");
    expect(optFinding).toBeDefined();
    expect(optFinding!.severity).toBe("INFO");
    expect(optFinding!.title).toContain("Option 2");
  });

  it("generates urgent alert for option at 30 days", async () => {
    const deps = createMockDeps({
      options: [
        {
          id: "opt-2",
          option_number: 3,
          option_start: "2025-01-01",
          option_end: "2025-12-31",
          option_value: "1500000.00",
          exercise_deadline: futureDate(25),
          status: "NOT_EXERCISED",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const optFinding = findings.find((f) => f.category === "OPTION");
    expect(optFinding).toBeDefined();
    expect(optFinding!.severity).toBe("URGENT");
    expect(optFinding!.daysRemaining).toBe(25);
  });

  it("transitions expired option to EXPIRED status", async () => {
    const deps = createMockDeps({
      options: [
        {
          id: "opt-3",
          option_number: 1,
          option_start: "2024-01-01",
          option_end: "2024-12-31",
          option_value: "3000000.00",
          exercise_deadline: pastDate(10),
          status: "NOT_EXERCISED",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    // Status updated to EXPIRED
    const updateCall = deps.queryCalls.find(
      (c) => c.sql.includes("UPDATE contracts.contract_options") && c.sql.includes("EXPIRED"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.params[0]).toBe("opt-3");

    // FSM transition triggered
    expect(deps.fsm.transition).toHaveBeenCalledWith(
      "PRIME_CONTRACT",
      "contract-001",
      "OPTION_EXPIRED",
      "system",
      "system",
    );

    // Finding is CRITICAL
    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const expired = findings.find(
      (f) => f.category === "OPTION" && f.severity === "CRITICAL",
    );
    expect(expired).toBeDefined();
    expect(expired!.title).toContain("EXPIRED");
  });

  // ─── Funding tests ────────────────────────────────────────────────

  it("triggers alert when funding at 80%", async () => {
    const deps = createMockDeps({
      contracts: [makeContract({ ceiling_value: "10000000.00", funded_value: "8500000.00" })],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const fundingFinding = findings.find((f) => f.category === "FUNDING");
    expect(fundingFinding).toBeDefined();
    expect(fundingFinding!.description).toContain("85%");
  });

  it("detects burn rate anomaly (burning faster than time elapsed)", async () => {
    // Contract started 6 months ago (Jan 1 to Jul 15 ≈ 196 days of 730 total = 27% time)
    // But 70% funded → anomaly (70% > 27% + 20%)
    const deps = createMockDeps({
      contracts: [makeContract({ ceiling_value: "10000000.00", funded_value: "7000000.00" })],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const anomaly = findings.find(
      (f) => f.category === "FUNDING" && f.description.includes("anomaly"),
    );
    expect(anomaly).toBeDefined();
    expect(anomaly!.severity).toBe("CRITICAL"); // 70% > 27% + 40%
  });

  // ─── Milestone tests ───────────────────────────────────────────────

  it("alerts for compliance milestone approaching deadline", async () => {
    const deps = createMockDeps({
      milestones: [
        {
          id: "ms-1",
          milestone_type: "SB Plan Submission",
          description: "Annual small business plan submission",
          due_date: futureDate(5),
          responsible_party: "sb-office@dynamo.com",
          status: "PENDING",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const msFinding = findings.find((f) => f.category === "MILESTONE");
    expect(msFinding).toBeDefined();
    expect(msFinding!.severity).toBe("URGENT");
    expect(msFinding!.title).toContain("SB Plan Submission");
    expect(msFinding!.description).toContain("sb-office@dynamo.com");
  });

  // ─── Property tests ────────────────────────────────────────────────

  it("alerts for government property inventory due date", async () => {
    const deps = createMockDeps({
      property: [
        {
          id: "prop-1",
          property_type: "IT_EQUIPMENT",
          description: "Laptops and monitors",
          inventory_due_date: futureDate(20),
          custodian: "property-mgr@dynamo.com",
          status: "ACTIVE",
        },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const propFinding = findings.find((f) => f.category === "PROPERTY");
    expect(propFinding).toBeDefined();
    expect(propFinding!.severity).toBe("WARNING");
    expect(propFinding!.title).toContain("Inventory");
    expect(propFinding!.description).toContain("property-mgr@dynamo.com");
  });

  // ─── POP expiration ────────────────────────────────────────────────

  it("alerts for POP expiration at 60 days", async () => {
    const deps = createMockDeps({
      contracts: [makeContract({ pop_end: futureDate(55) })],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createTask());

    const findings = result.data!.findings as unknown as ComplianceFinding[];
    const popFinding = findings.find((f) => f.category === "POP_EXPIRATION");
    expect(popFinding).toBeDefined();
    expect(popFinding!.severity).toBe("WARNING");
    expect(popFinding!.daysRemaining).toBe(55);
    expect(popFinding!.title).toContain("POP ends");
  });

  // ─── Weekly summary email ──────────────────────────────────────────

  it("weekly summary email contains all findings", async () => {
    const deps = createMockDeps({
      deliverables: [
        {
          id: "del-s1",
          deliverable_type: "Report",
          description: "Report due soon",
          due_date: futureDate(5),
          status: "IN_PROGRESS",
        },
      ],
      milestones: [
        {
          id: "ms-s1",
          milestone_type: "CDRL",
          description: "CDRL delivery",
          due_date: pastDate(2),
          responsible_party: "team@dynamo.com",
          status: "PENDING",
        },
      ],
    });
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, mcp);

    await agent.execute(createTask());

    const emailCall = mcpSpy.mock.calls.find(
      ([name]) => name === "microsoft.outlook.sendEmail",
    );
    expect(emailCall).toBeDefined();

    const [, params] = emailCall!;
    expect(params.subject).toContain("Weekly Compliance Summary");
    expect(params.body).toContain("OVERDUE ITEMS");
    expect(params.body).toContain("UPCOMING");
    expect(params.body).toContain("FUNDING STATUS");
    expect(params.body).toContain("CDRL");
    expect(params.body).toContain("Report");
  });

  // ─── Jira dedup ────────────────────────────────────────────────────

  it("does NOT create duplicate Jira tickets for existing open items", async () => {
    const deps = createMockDeps({
      deliverables: [
        {
          id: "del-dup",
          deliverable_type: "Report",
          description: "Already tracked",
          due_date: futureDate(5),
          status: "IN_PROGRESS",
        },
      ],
      existingJiraTickets: [{ id: "existing-ticket-1" }],
    });
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, mcp);

    const result = await agent.execute(createTask());

    // Should NOT have created a jira.createIssue for this deliverable
    const jiraCreateCalls = mcpSpy.mock.calls.filter(
      ([name]) => name === "jira.createIssue",
    );
    expect(jiraCreateCalls.length).toBe(0);
    expect(result.data!.jiraTicketsCreated).toBe(0);
  });

  // ─── Teams notifications ───────────────────────────────────────────

  it("sends Teams notifications for urgent/critical findings", async () => {
    const deps = createMockDeps({
      deliverables: [
        {
          id: "del-t1",
          deliverable_type: "Final Report",
          description: "Final deliverable",
          due_date: pastDate(5),
          status: "IN_PROGRESS",
        },
      ],
    });
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, mcp);

    await agent.execute(createTask());

    const teamsCall = mcpSpy.mock.calls.find(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCall).toBeDefined();
    expect(teamsCall![1].channelId).toBe("contracts-compliance");
    expect(teamsCall![1].message).toContain("CRITICAL");
    expect(teamsCall![1].message).toContain("FA8726-24-C-0042");
  });

  // ─── Performance test ──────────────────────────────────────────────

  it("completes daily run for 50 contracts within reasonable time", async () => {
    const contracts = Array.from({ length: 50 }, (_, i) =>
      makeContract({
        id: `contract-${i}`,
        contract_number: `FA8726-24-C-${String(i).padStart(4, "0")}`,
      }),
    );

    const deps = createMockDeps({ contracts });
    const agent = buildAgent(deps);

    const start = performance.now();
    const result = await agent.execute(createTask());
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.data!.totalContracts).toBe(50);
    // Should complete in under 2 seconds (no real I/O)
    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── FundingCalculator unit tests ────────────────────────────────────

describe("FundingCalculator", () => {
  const calc = new FundingCalculator(NOW);

  it("calculates correct funding ratio", () => {
    const contract: ContractFundingData = {
      contractId: "c-1",
      contractNumber: "TEST-001",
      ceilingValue: 10_000_000,
      fundedValue: 8_000_000,
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
    };

    const analysis = calc.calculateBurnRate(contract);

    expect(analysis.fundingRatio).toBeCloseTo(0.8, 2);
    expect(analysis.ceilingRemaining).toBe(2_000_000);
    expect(analysis.alerts.some((a) => a.type === "HIGH_FUNDING")).toBe(true);
  });

  it("detects burn rate anomaly", () => {
    // POP: 2024-01-01 to 2025-12-31 (730 days)
    // NOW: 2024-07-15 → ~196 days elapsed → ~27% time
    // Funded 70% → anomaly (70% > 27% + 20%)
    const contract: ContractFundingData = {
      contractId: "c-2",
      contractNumber: "TEST-002",
      ceilingValue: 10_000_000,
      fundedValue: 7_000_000,
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
    };

    const analysis = calc.calculateBurnRate(contract);

    expect(analysis.alerts.some((a) => a.type === "BURN_RATE_ANOMALY")).toBe(true);
  });

  it("projects runout date", () => {
    const contract: ContractFundingData = {
      contractId: "c-3",
      contractNumber: "TEST-003",
      ceilingValue: 10_000_000,
      fundedValue: 5_000_000,
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
    };

    const runout = calc.projectRunoutDate(contract);
    expect(runout).toBeInstanceOf(Date);
    // Should be roughly the same time in the future as has elapsed
    expect(runout!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("estimates monthly burn", () => {
    const contract: ContractFundingData = {
      contractId: "c-4",
      contractNumber: "TEST-004",
      ceilingValue: 10_000_000,
      fundedValue: 5_000_000,
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
    };

    const monthly = calc.estimateMonthlyBurn(contract);
    // ~196 days elapsed → ~6.4 months. $5M / 6.4 ≈ $780K/mo
    expect(monthly).toBeGreaterThan(700_000);
    expect(monthly).toBeLessThan(900_000);
  });
});
