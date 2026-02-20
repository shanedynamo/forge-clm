import { describe, it, expect, vi } from "vitest";
import {
  ClauseAnalysisAgent,
  parseAnalysisResponse,
  computeOverallRisk,
  type ClauseRiskAssessment,
  type ClauseAnalysisPayload,
} from "../clause-analysis.js";
import {
  PlaybookEngine,
  SAMPLE_PLAYBOOK_RULES,
  type PlaybookRule,
  type ClauseInput,
} from "../helpers/playbook-engine.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";
import type { AgentTask, AgentDependencies } from "../../framework/base-agent.js";

// ─── Sample rules with IDs ──────────────────────────────────────────

const RULES: PlaybookRule[] = SAMPLE_PLAYBOOK_RULES.map((r, i) => ({
  ...r,
  id: `rule-${i + 1}`,
}));

// ─── Mock LLM responses ─────────────────────────────────────────────

const LLM_IP_DEVIATION = JSON.stringify({
  deviation_found: true,
  severity: "CRITICAL",
  explanation:
    "The clause grants the Government unlimited rights to all technical data, deviating from Dynamo's standard GPR position. This could result in loss of proprietary IP.",
  recommended_redline:
    "Replace 'unlimited rights' with 'Government Purpose Rights' for all contractor-developed technical data.",
});

const LLM_HIGH_DEVIATION = JSON.stringify({
  deviation_found: true,
  severity: "HIGH",
  explanation:
    "The technical data rights clause omits the standard 5-year restriction period for GPR data.",
  recommended_redline:
    "Add: 'Government Purpose Rights data shall have a 5-year restriction period from date of delivery.'",
});

const LLM_NO_DEVIATION = JSON.stringify({
  deviation_found: false,
  severity: "LOW",
  explanation:
    "Clause language aligns with Dynamo's standard position. No deviation detected.",
  recommended_redline: null,
});

const LLM_MEDIUM_DEVIATION_NO_REDLINE = JSON.stringify({
  deviation_found: true,
  severity: "MEDIUM",
  explanation:
    "The termination notice period is 15 days, below Dynamo's 30-day standard.",
  recommended_redline: null,
});

// ─── Test helpers ────────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function createMockDeps(options?: {
  llmResponse?: string;
  llmResponses?: string[];
  clauses?: Array<{ clause_number: string; clause_title: string; clause_type: string }>;
  hasPlaybookRules?: boolean;
}): AgentDependencies & { queryCalls: QueryCall[] } {
  const queryCalls: QueryCall[] = [];
  let llmCallIndex = 0;

  const defaultClauses = options?.clauses ?? [
    { clause_number: "52.227-14", clause_title: "Rights in Data - General", clause_type: "FAR" },
    { clause_number: "252.227-7014", clause_title: "Rights in Other Than Commercial Technical Data", clause_type: "DFARS" },
    { clause_number: "52.219-8", clause_title: "Utilization of Small Business Concerns", clause_type: "FAR" },
    { clause_number: "252.204-7012", clause_title: "Safeguarding Covered Defense Information", clause_type: "DFARS" },
    { clause_number: "52.212-4", clause_title: "Contract Terms and Conditions", clause_type: "FAR" },
  ];

  const queryFn = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
    queryCalls.push({ sql, params });

    if (sql.includes("SELECT clause_number")) {
      return defaultClauses;
    }

    if (sql.includes("FROM agents.playbook_rules")) {
      if (options?.hasPlaybookRules === false) return [];
      // Return empty to trigger fallback to SAMPLE_PLAYBOOK_RULES
      return [];
    }

    if (sql.includes("UPDATE contracts.contract_clauses")) {
      return [];
    }

    return [];
  });

  const completeFn = options?.llmResponses
    ? vi.fn().mockImplementation(() => {
        const response = options.llmResponses![llmCallIndex] ?? LLM_NO_DEVIATION;
        llmCallIndex++;
        return Promise.resolve(response);
      })
    : vi.fn().mockResolvedValue(options?.llmResponse ?? LLM_IP_DEVIATION);

  return {
    queryCalls,
    llm: { complete: completeFn },
    vectorSearch: {
      search: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk-p1",
          chunkText: "Similar IP rights clause from prior contract with GPR designation.",
          similarityScore: 0.92,
          contractId: "precedent-contract-1",
          sectionType: "SECTION_H",
          clauseNumber: "52.227-14",
        },
        {
          chunkId: "chunk-p2",
          chunkText: "Data rights clause with unlimited rights to government.",
          similarityScore: 0.87,
          contractId: "precedent-contract-2",
          sectionType: "SECTION_I",
          clauseNumber: "52.227-14",
        },
      ]),
    },
    database: {
      query: queryFn,
      getContractContext: vi.fn().mockResolvedValue({
        contractId: "contract-001",
        contractNumber: "FA8726-24-C-0042",
        status: "ACTIVE",
        contractType: "CPFF",
        ceilingValue: "12500000.00",
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

function createAnalysisTask(overrides?: Partial<ClauseAnalysisPayload>): AgentTask {
  return {
    id: "task-analysis-001",
    agentName: "clause-analysis",
    triggerType: "EVENT",
    triggerPayload: {
      contractId: "contract-001",
      ...overrides,
    } as unknown as Record<string, unknown>,
    priority: "MEDIUM",
    createdAt: new Date(),
  };
}

function buildAgent(
  deps: AgentDependencies,
  mcp?: ArcadeClient,
) {
  return new ClauseAnalysisAgent(deps, {
    mcp: mcp ?? new ArcadeClient({ mode: "mock" }),
    config: { maxPrecedents: 2 },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("ClauseAnalysisAgent", () => {
  // ─── PlaybookEngine tests ──────────────────────────────────────────

  it("loads correct rules for a CPFF contract", () => {
    const engine = new PlaybookEngine();
    const rules = engine.loadRules(RULES, "CPFF");

    // CPFF-specific rules: IP Rights (52.227-14*), CAS compliance (52.230-*)
    // Plus all rules without contract_type restrictions
    expect(rules.length).toBeGreaterThan(0);

    // Should include IP rights rule (has CPFF in contract_types)
    const ipRule = rules.find((r) => r.ruleName.includes("Unlimited Rights"));
    expect(ipRule).toBeDefined();

    // Should include CAS rule (has CPFF in contract_types)
    const casRule = rules.find((r) => r.ruleName.includes("Cost Accounting"));
    expect(casRule).toBeDefined();

    // Should also include rules without contract_type restrictions (e.g., Cybersecurity)
    const cyberRule = rules.find((r) => r.ruleName.includes("Cybersecurity"));
    expect(cyberRule).toBeDefined();

    // Rules should be sorted by priority descending
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1]!.priority).toBeGreaterThanOrEqual(rules[i]!.priority);
    }
  });

  it("evaluates a clause against matching rules", () => {
    const engine = new PlaybookEngine();
    const rules = engine.loadRules(RULES);

    const clause: ClauseInput = {
      clauseNumber: "52.227-14",
      clauseTitle: "Rights in Data - General",
      clauseType: "FAR",
    };

    const matches = engine.evaluateClause(clause, rules);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.rule.ruleName).toContain("IP Rights");
    expect(matches[0]!.matchedPattern).toBe("52.227-14*");
  });

  // ─── LLM analysis tests ───────────────────────────────────────────

  it("identifies a deviation in IP rights clause via LLM", async () => {
    const deps = createMockDeps({
      llmResponse: LLM_IP_DEVIATION,
      clauses: [
        { clause_number: "52.227-14", clause_title: "Rights in Data", clause_type: "FAR" },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createAnalysisTask());

    expect(result.success).toBe(true);
    const assessments = result.data!.assessments as any[];
    const ipAssessment = assessments.find(
      (a: any) => a.clauseNumber === "52.227-14",
    );
    expect(ipAssessment).toBeDefined();
    expect(ipAssessment.deviationFound).toBe(true);
    expect(ipAssessment.severity).toBe("CRITICAL");
    expect(ipAssessment.explanation).toContain("unlimited rights");
  });

  it("produces correct severity levels from risk scoring", async () => {
    const deps = createMockDeps({
      llmResponses: [
        LLM_IP_DEVIATION,    // CRITICAL for 52.227-14
        LLM_HIGH_DEVIATION,  // HIGH for 252.227-7014
        LLM_NO_DEVIATION,    // LOW for 52.219-8
        LLM_IP_DEVIATION,    // CRITICAL for 252.204-7012
      ],
      clauses: [
        { clause_number: "52.227-14", clause_title: "Rights in Data", clause_type: "FAR" },
        { clause_number: "252.227-7014", clause_title: "Technical Data Rights", clause_type: "DFARS" },
        { clause_number: "52.219-8", clause_title: "Small Business", clause_type: "FAR" },
        { clause_number: "252.204-7012", clause_title: "Cybersecurity", clause_type: "DFARS" },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createAnalysisTask());

    expect(result.data!.overallRisk).toBe("CRITICAL");
    const breakdown = result.data!.riskBreakdown as Record<string, number>;
    expect(breakdown["CRITICAL"]).toBe(2);
    expect(breakdown["HIGH"]).toBe(1);
  });

  it("generates redline for HIGH risk deviation", async () => {
    const deps = createMockDeps({
      llmResponse: LLM_HIGH_DEVIATION,
      clauses: [
        { clause_number: "252.227-7014", clause_title: "Technical Data", clause_type: "DFARS" },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createAnalysisTask());

    const assessments = result.data!.assessments as any[];
    expect(assessments.length).toBe(1);
    expect(assessments[0].recommendedRedline).toContain("5-year restriction period");
  });

  // ─── Precedent search ──────────────────────────────────────────────

  it("returns relevant precedents from similar clause search", async () => {
    const deps = createMockDeps({
      llmResponse: LLM_IP_DEVIATION,
      clauses: [
        { clause_number: "52.227-14", clause_title: "Rights in Data", clause_type: "FAR" },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createAnalysisTask());

    // Vector search should be called
    expect(deps.vectorSearch.search).toHaveBeenCalled();

    const assessments = result.data!.assessments as any[];
    const ipAssessment = assessments[0];
    expect(ipAssessment.precedents.length).toBeGreaterThan(0);
    // Should exclude the current contract
    expect(
      ipAssessment.precedents.every(
        (p: any) => p.contractId !== "contract-001",
      ),
    ).toBe(true);
    expect(ipAssessment.precedents[0].similarityScore).toBeGreaterThan(0.8);
  });

  // ─── Report structure ──────────────────────────────────────────────

  it("produces full analysis report structure", async () => {
    const deps = createMockDeps({
      llmResponses: [
        LLM_IP_DEVIATION,    // 52.227-14
        LLM_HIGH_DEVIATION,  // 252.227-7014
        LLM_NO_DEVIATION,    // 52.219-8
        LLM_IP_DEVIATION,    // 252.204-7012
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createAnalysisTask());

    expect(result.success).toBe(true);
    expect(result.data!.contractId).toBe("contract-001");
    expect(result.data!.overallRisk).toBeDefined();
    expect(result.data!.totalClauses).toBe(5);
    expect(typeof result.data!.analyzedClauses).toBe("number");
    expect(result.data!.riskBreakdown).toBeDefined();
    expect(result.data!.jiraKey).toBeDefined();
    expect(typeof result.data!.teamsAlertSent).toBe("boolean");

    // Assessments array with expected shape
    const assessments = result.data!.assessments as any[];
    expect(assessments.length).toBeGreaterThan(0);
    for (const a of assessments) {
      expect(a.clauseNumber).toBeDefined();
      expect(a.matchedRule).toBeDefined();
      expect(a.standardPosition).toBeDefined();
      expect(typeof a.deviationFound).toBe("boolean");
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(a.severity);
      expect(a.explanation).toBeDefined();
      expect(Array.isArray(a.precedents)).toBe(true);
    }
  });

  // ─── Jira ticket ───────────────────────────────────────────────────

  it("creates Jira ticket with analysis results", async () => {
    const deps = createMockDeps({ llmResponse: LLM_IP_DEVIATION });
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, mcp);

    await agent.execute(createAnalysisTask());

    const jiraCall = mcpSpy.mock.calls.find(
      ([name]) => name === "jira.createIssue",
    );
    expect(jiraCall).toBeDefined();

    const [, params] = jiraCall!;
    expect(params.summary).toContain("[CLAUSE-ANALYSIS]");
    expect(params.summary).toContain("contract-001");
    expect(params.description).toContain("Clause Analysis Report");
    expect(params.description).toContain("Risk Breakdown");
    expect((params.fields as any).labels).toContain("clause-analysis");
  });

  // ─── Teams alert ───────────────────────────────────────────────────

  it("sends Teams alert for CRITICAL risks", async () => {
    const deps = createMockDeps({ llmResponse: LLM_IP_DEVIATION });
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, mcp);

    const result = await agent.execute(createAnalysisTask());

    expect(result.data!.teamsAlertSent).toBe(true);

    const teamsCall = mcpSpy.mock.calls.find(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCall).toBeDefined();

    const [, params] = teamsCall!;
    expect(params.message).toContain("CRITICAL RISK ALERT");
    expect(params.message).toContain("contract-001");
    expect(params.message).toContain("Action Required");
  });

  // ─── DB update ─────────────────────────────────────────────────────

  it("updates contract_clauses risk_category in the database", async () => {
    const deps = createMockDeps({
      llmResponse: LLM_IP_DEVIATION,
      clauses: [
        { clause_number: "52.227-14", clause_title: "Rights in Data", clause_type: "FAR" },
      ],
    });
    const agent = buildAgent(deps);

    await agent.execute(createAnalysisTask());

    const updateCalls = deps.queryCalls.filter((c) =>
      c.sql.includes("UPDATE contracts.contract_clauses"),
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]!.params[0]).toBe("CRITICAL"); // risk_category
    expect(updateCalls[0]!.params[1]).toBe("contract-001"); // contract_id
    expect(updateCalls[0]!.params[2]).toBe("52.227-14"); // clause_number
  });

  // ─── No matching rules ────────────────────────────────────────────

  it("handles clauses with no matching playbook rules", async () => {
    const deps = createMockDeps({
      clauses: [
        // A clause number that doesn't match any playbook patterns
        { clause_number: "99.999-99", clause_title: "Nonexistent Clause", clause_type: "FAR" },
      ],
    });
    const agent = buildAgent(deps);

    const result = await agent.execute(createAnalysisTask());

    expect(result.success).toBe(true);
    expect(result.data!.analyzedClauses).toBe(0);
    expect(result.data!.overallRisk).toBe("LOW");
    // LLM should NOT have been called (no matching rules)
    expect(deps.llm.complete).not.toHaveBeenCalled();
  });

  // ─── End-to-end ────────────────────────────────────────────────────

  it("end-to-end: ingest contract -> trigger analysis -> verify report", async () => {
    // Simulate a contract with mixed risk clauses
    const deps = createMockDeps({
      llmResponses: [
        LLM_IP_DEVIATION,              // 52.227-14 → CRITICAL
        LLM_HIGH_DEVIATION,            // 252.227-7014 → HIGH
        LLM_MEDIUM_DEVIATION_NO_REDLINE, // 52.219-8 → MEDIUM
        LLM_IP_DEVIATION,              // 252.204-7012 → CRITICAL
        // 52.212-4 has no matching rule → skipped
      ],
    });
    const mcp = new ArcadeClient({ mode: "mock" });
    const mcpSpy = vi.spyOn(mcp, "executeTool");
    const agent = buildAgent(deps, mcp);

    const result = await agent.execute(createAnalysisTask());

    // 1. Success
    expect(result.success).toBe(true);

    // 2. Overall risk is CRITICAL (highest found)
    expect(result.data!.overallRisk).toBe("CRITICAL");

    // 3. Correct clause counts
    expect(result.data!.totalClauses).toBe(5);
    // 4 clauses have matching rules, 1 (52.212-4) does not
    expect(result.data!.analyzedClauses).toBe(4);

    // 4. Risk breakdown
    const breakdown = result.data!.riskBreakdown as Record<string, number>;
    expect(breakdown["CRITICAL"]).toBe(2);
    expect(breakdown["HIGH"]).toBe(1);
    expect(breakdown["MEDIUM"]).toBe(1);

    // 5. Critical count triggers Teams alert
    expect(result.data!.criticalCount).toBe(2);
    expect(result.data!.teamsAlertSent).toBe(true);

    // 6. Jira ticket created
    expect(result.data!.jiraKey).toBeDefined();
    const jiraCall = mcpSpy.mock.calls.find(
      ([name]) => name === "jira.createIssue",
    );
    expect(jiraCall).toBeDefined();
    expect(jiraCall![1].description).toContain("CRITICAL: 2");

    // 7. Teams alert sent
    const teamsCall = mcpSpy.mock.calls.find(
      ([name]) => name === "microsoft.teams.sendMessage",
    );
    expect(teamsCall).toBeDefined();

    // 8. DB updates for risk_category
    const updateCalls = deps.queryCalls.filter((c) =>
      c.sql.includes("UPDATE contracts.contract_clauses"),
    );
    expect(updateCalls.length).toBe(4); // One per analyzed clause

    // 9. Audit logged
    const auditLog = deps.audit.log as ReturnType<typeof vi.fn>;
    expect(auditLog).toHaveBeenCalledTimes(2);
    expect(auditLog.mock.calls[0]![0].status).toBe("RUNNING");
    expect(auditLog.mock.calls[1]![0].status).toBe("SUCCESS");
    expect(auditLog.mock.calls[1]![0].outputSummary.criticalCount).toBe(2);

    // 10. The MEDIUM-deviation clause should get a fallback redline from the rule template
    const assessments = result.data!.assessments as any[];
    const sbAssessment = assessments.find(
      (a: any) => a.clauseNumber === "52.219-8",
    );
    expect(sbAssessment).toBeDefined();
    expect(sbAssessment.recommendedRedline).toBeDefined();
    expect(sbAssessment.recommendedRedline).toContain("small business");
  });
});

// ─── Unit tests for helpers ──────────────────────────────────────────

describe("parseAnalysisResponse", () => {
  it("parses valid JSON", () => {
    const result = parseAnalysisResponse(LLM_IP_DEVIATION, "HIGH");
    expect(result.deviation_found).toBe(true);
    expect(result.severity).toBe("CRITICAL");
    expect(result.explanation).toContain("unlimited rights");
    expect(result.recommended_redline).toBeDefined();
  });

  it("uses fallback severity for invalid values", () => {
    const raw = JSON.stringify({
      deviation_found: true,
      severity: "INVALID",
      explanation: "test",
      recommended_redline: null,
    });
    const result = parseAnalysisResponse(raw, "HIGH");
    expect(result.severity).toBe("HIGH");
  });
});

describe("computeOverallRisk", () => {
  it("returns highest severity among deviations", () => {
    const assessments: ClauseRiskAssessment[] = [
      {
        clauseNumber: "a", clauseTitle: "A", clauseType: "FAR",
        matchedRule: "r1", standardPosition: "s", deviationFound: true,
        severity: "HIGH", explanation: "e", recommendedRedline: null, precedents: [],
      },
      {
        clauseNumber: "b", clauseTitle: "B", clauseType: "FAR",
        matchedRule: "r2", standardPosition: "s", deviationFound: true,
        severity: "CRITICAL", explanation: "e", recommendedRedline: null, precedents: [],
      },
    ];
    expect(computeOverallRisk(assessments)).toBe("CRITICAL");
  });

  it("returns LOW when no deviations found", () => {
    const assessments: ClauseRiskAssessment[] = [
      {
        clauseNumber: "a", clauseTitle: "A", clauseType: "FAR",
        matchedRule: "r1", standardPosition: "s", deviationFound: false,
        severity: "LOW", explanation: "e", recommendedRedline: null, precedents: [],
      },
    ];
    expect(computeOverallRisk(assessments)).toBe("LOW");
  });

  it("returns LOW for empty assessments", () => {
    expect(computeOverallRisk([])).toBe("LOW");
  });
});
