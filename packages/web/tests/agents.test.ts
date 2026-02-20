import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import AgentsPage from "../src/routes/agents/+page.svelte";
import type {
  AgentRegistryEntry,
  AgentExecution,
  SystemHealth,
  AuthRole,
} from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

const MOCK_AGENTS: AgentRegistryEntry[] = [
  {
    id: "agent-1",
    name: "Clause Analyzer",
    type: "CLAUSE_ANALYZER",
    status: "ENABLED",
    description: "Analyzes contract clauses for risk and compliance",
    lastRunAt: "2026-02-19T08:00:00Z",
    successRate: 0.95,
    avgExecutionTimeMs: 2300,
    totalRuns: 142,
  },
  {
    id: "agent-2",
    name: "Compliance Monitor",
    type: "COMPLIANCE_MONITOR",
    status: "ENABLED",
    description: "Monitors compliance milestones and deadlines",
    lastRunAt: "2026-02-19T07:30:00Z",
    successRate: 0.99,
    avgExecutionTimeMs: 1800,
    totalRuns: 320,
  },
  {
    id: "agent-3",
    name: "Risk Assessor",
    type: "RISK_ASSESSOR",
    status: "DISABLED",
    description: "Assesses contract risk levels",
    lastRunAt: null,
    successRate: 0,
    avgExecutionTimeMs: 0,
    totalRuns: 0,
  },
];

const MOCK_HEALTH: SystemHealth = {
  queueDepth: 5,
  activeTasks: 2,
  errorRate: 0.03,
  uptime: "14d 6h 32m",
  lastHealthCheck: "2026-02-19T10:00:00Z",
};

const MOCK_EXECUTIONS: AgentExecution[] = [
  {
    id: "exec-1",
    agentId: "agent-1",
    agentName: "Clause Analyzer",
    status: "SUCCESS",
    startedAt: "2026-02-19T08:00:00Z",
    completedAt: "2026-02-19T08:00:02Z",
    durationMs: 2300,
    inputSummary: "Contract FA8726-24-C-0042, 12 clauses",
    outputSummary: "3 high-risk clauses identified",
    error: null,
  },
  {
    id: "exec-2",
    agentId: "agent-1",
    agentName: "Clause Analyzer",
    status: "FAILED",
    startedAt: "2026-02-19T07:00:00Z",
    completedAt: "2026-02-19T07:00:05Z",
    durationMs: 5100,
    inputSummary: "Contract N00024-23-C-5500, 8 clauses",
    outputSummary: null,
    error: "Timeout: LLM response exceeded 30s limit",
  },
  {
    id: "exec-3",
    agentId: "agent-1",
    agentName: "Clause Analyzer",
    status: "SUCCESS",
    startedAt: "2026-02-19T06:00:00Z",
    completedAt: "2026-02-19T06:00:01Z",
    durationMs: 1200,
    inputSummary: "Contract W912HZ-25-C-0001, 5 clauses",
    outputSummary: "No high-risk clauses found",
    error: null,
  },
];

function makeData(overrides: Partial<{
  agents: AgentRegistryEntry[];
  health: SystemHealth;
  userRole: AuthRole;
}> = {}) {
  return {
    data: {
      agents: overrides.agents ?? MOCK_AGENTS,
      health: overrides.health ?? MOCK_HEALTH,
      userRole: overrides.userRole ?? ("admin" as AuthRole),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Agent Monitor", () => {
  it("renders agent registry table with status indicators", () => {
    render(AgentsPage, { props: makeData() });

    const rows = screen.getAllByTestId("agent-row");
    expect(rows.length).toBe(3);

    // Check names
    const names = screen.getAllByTestId("agent-name");
    expect(names[0]!.textContent).toBe("Clause Analyzer");
    expect(names[1]!.textContent).toBe("Compliance Monitor");
    expect(names[2]!.textContent).toBe("Risk Assessor");

    // Check types
    const types = screen.getAllByTestId("agent-type");
    expect(types[0]!.textContent).toBe("CLAUSE ANALYZER");

    // Check status indicators
    const statusDots = screen.getAllByTestId("status-dot");
    expect(statusDots[0]!.className).toContain("bg-green");
    expect(statusDots[2]!.className).toContain("bg-gray");

    // Check success rate
    const rates = screen.getAllByTestId("agent-success-rate");
    expect(rates[0]!.textContent).toBe("95%");
    expect(rates[2]!.textContent).toBe("0%");

    // Check avg time
    const times = screen.getAllByTestId("agent-avg-time");
    expect(times[0]!.textContent).toBe("2.3s");
  });

  it("shows execution history when clicking an agent", async () => {
    render(AgentsPage, {
      props: {
        ...makeData(),
        initialExecutions: MOCK_EXECUTIONS,
      },
    });

    // Panel should not be visible initially
    expect(screen.queryByTestId("execution-panel")).toBeNull();

    // Click first agent
    const rows = screen.getAllByTestId("agent-row");
    await fireEvent.click(rows[0]!);

    // Panel should appear
    expect(screen.getByTestId("execution-panel")).toBeInTheDocument();

    // Should show 3 executions for agent-1
    const items = screen.getAllByTestId("execution-item");
    expect(items.length).toBe(3);

    // Check execution statuses
    const statuses = screen.getAllByTestId("exec-status");
    expect(statuses[0]!.textContent).toBe("SUCCESS");
    expect(statuses[1]!.textContent).toBe("FAILED");
    expect(statuses[2]!.textContent).toBe("SUCCESS");
  });

  it("displays system health metrics", () => {
    render(AgentsPage, { props: makeData() });

    expect(screen.getByTestId("health-queue-depth").textContent).toContain(
      "5",
    );
    expect(screen.getByTestId("health-active-tasks").textContent).toContain(
      "2",
    );
    expect(screen.getByTestId("health-error-rate").textContent).toContain(
      "3%",
    );
    expect(screen.getByTestId("health-uptime").textContent).toContain(
      "14d 6h 32m",
    );
  });

  it("manual trigger button visible only for admin users", async () => {
    // Admin can see trigger button
    const { unmount } = render(AgentsPage, {
      props: {
        ...makeData({ userRole: "admin" }),
        initialExecutions: MOCK_EXECUTIONS,
      },
    });

    await fireEvent.click(screen.getAllByTestId("agent-row")[0]!);
    expect(screen.getByTestId("trigger-btn")).toBeInTheDocument();
    unmount();

    // Viewer cannot see trigger button
    render(AgentsPage, {
      props: {
        ...makeData({ userRole: "viewer" }),
        initialExecutions: MOCK_EXECUTIONS,
      },
    });

    await fireEvent.click(screen.getAllByTestId("agent-row")[0]!);
    expect(screen.queryByTestId("trigger-btn")).toBeNull();
  });

  it("execution detail shows input/output and timing", async () => {
    render(AgentsPage, {
      props: {
        ...makeData(),
        initialExecutions: MOCK_EXECUTIONS,
        initialSelectedAgentId: "agent-1",
      },
    });

    // Execution list should be visible (agent pre-selected)
    const items = screen.getAllByTestId("execution-item");
    expect(items.length).toBe(3);

    // Click first execution (SUCCESS)
    await fireEvent.click(items[0]!);

    const detail = screen.getByTestId("execution-detail");
    expect(detail).toBeInTheDocument();

    expect(screen.getByTestId("detail-input").textContent).toContain(
      "FA8726-24-C-0042",
    );
    expect(screen.getByTestId("detail-output").textContent).toContain(
      "3 high-risk clauses",
    );
    expect(screen.getByTestId("detail-duration").textContent).toContain(
      "2.3s",
    );

    // Click failed execution
    await fireEvent.click(items[1]!);
    expect(screen.getByTestId("detail-error").textContent).toContain(
      "Timeout",
    );
    expect(screen.getByTestId("detail-duration").textContent).toContain(
      "5.1s",
    );
  });
});
