import { describe, it, expect, vi } from "vitest";
import {
  FlowdownGeneratorAgent,
  type FlowdownMatrixEntry,
} from "../flowdown-generator.js";
import type {
  AgentTask,
  AgentDependencies,
} from "../../framework/base-agent.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";

// ─── Constants ───────────────────────────────────────────────────────

const CONTRACT_ID = "contract-001";
const SUB_ID = "sub-001";

// ─── Mock data builders ──────────────────────────────────────────────

function makeTask(
  overrides?: Partial<{ contractId: string; subcontractId: string }>,
): AgentTask {
  return {
    id: "task-flowdown-001",
    agentName: "flowdown-generator",
    triggerType: "EVENT",
    priority: "MEDIUM",
    createdAt: new Date(),
    triggerPayload: {
      contractId: CONTRACT_ID,
      subcontractId: SUB_ID,
      triggerReason: "NEW_SUBCONTRACT",
      ...overrides,
    },
  };
}

function makeClauseRows(
  list: Array<{
    number: string;
    title: string;
    type: string;
    flowdown?: boolean;
  }>,
) {
  return list.map((c, i) => ({
    id: `clause-${String(i + 1).padStart(3, "0")}`,
    clause_number: c.number,
    clause_title: c.title,
    clause_type: c.type,
    flowdown_required: c.flowdown ?? false,
  }));
}

// Subcontract row factories
const LARGE_SUB_ROW = {
  id: SUB_ID,
  subcontractor_name: "Acme Defense Corp",
  subcontractor_cage: "1A2B3",
  sub_type: "Engineering Services",
  ceiling_value: "500000.00",
  prime_contract_id: CONTRACT_ID,
  business_size: "LARGE",
};

const SMALL_SUB_ROW = {
  ...LARGE_SUB_ROW,
  business_size: "SMALL",
  subcontractor_name: "SmallTech LLC",
};

const CUI_SUB_ROW = {
  ...LARGE_SUB_ROW,
  sub_type: "Cyber Security CUI Processing",
};

const LOW_VALUE_SUB_ROW = {
  ...LARGE_SUB_ROW,
  ceiling_value: "8000.00",
};

// ─── Query call tracking ─────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

// ─── Mock builder ────────────────────────────────────────────────────

function buildMocks(opts: {
  clauseRows?: unknown[];
  subRow?: Record<string, unknown>;
  libraryRows?: unknown[];
  llmResponses?: string[];
}) {
  const queryCalls: QueryCall[] = [];
  let llmIdx = 0;
  const llmResponses = opts.llmResponses ?? ["VERBATIM"];

  const mockDeps: AgentDependencies = {
    llm: {
      complete: vi.fn(async () => {
        const r = llmResponses[llmIdx % llmResponses.length]!;
        llmIdx++;
        return r;
      }),
    },
    vectorSearch: { search: vi.fn(async () => []) },
    database: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queryCalls.push({ sql, params });

        if (sql.includes("contract_clauses") && sql.includes("SELECT")) {
          return opts.clauseRows ?? [];
        }
        if (sql.includes("subcontracts") && sql.includes("SELECT")) {
          return [opts.subRow ?? LARGE_SUB_ROW];
        }
        if (sql.includes("clause_library") && sql.includes("SELECT")) {
          return opts.libraryRows ?? [];
        }
        if (sql.includes("INSERT INTO contracts.flowdown_requirements")) {
          return [];
        }
        return [];
      }),
      getContractContext: vi.fn(async () => ({
        contractId: CONTRACT_ID,
        contractNumber: "W56HZV-24-C-0001",
        status: "ACTIVE",
        contractType: "FFP",
        ceilingValue: "5000000.00",
        fundedValue: "3000000.00",
        awardingAgency: "US Army",
        popStart: "2024-01-01",
        popEnd: "2026-12-31",
      })),
    },
    audit: { log: vi.fn(async () => {}) },
    fsm: {
      transition: vi.fn(async () => "OK"),
      getAvailableTransitions: vi.fn(async () => []),
    },
  };

  const mockMcp = new ArcadeClient({ mockMode: true });
  vi.spyOn(mockMcp, "executeTool").mockImplementation(
    async (toolName: string) => {
      if (toolName === "microsoft.word.createDocument") {
        return {
          success: true,
          data: {
            documentUrl:
              "https://sharepoint.example.com/docs/flowdown-matrix.docx",
          },
        };
      }
      if (toolName === "jira.createIssue") {
        return { success: true, data: { issueKey: "FORGE-789" } };
      }
      return { success: true, data: {} };
    },
  );

  return { mockDeps, mockMcp, queryCalls };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("FlowdownGeneratorAgent", () => {
  // ── Determination logic ────────────────────────────────────────────

  it("identifies mandatory flowdown clause correctly", async () => {
    const clauses = makeClauseRows([
      {
        number: "52.222-50",
        title: "Combating Trafficking in Persons",
        type: "FAR",
      },
    ]);
    const { mockDeps, mockMcp } = buildMocks({ clauseRows: clauses });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];

    expect(matrix).toHaveLength(1);
    expect(matrix[0]!.prime_clause).toBe("52.222-50");
    expect(matrix[0]!.flows_down).toBe(true);
    expect(matrix[0]!.basis).toBe("MANDATORY");
    expect(matrix[0]!.notes).toContain("mandatory");
  });

  it("applies small business exemption", async () => {
    const clauses = makeClauseRows([
      {
        number: "52.219-8",
        title: "Utilization of Small Business Concerns",
        type: "FAR",
      },
      {
        number: "52.222-50",
        title: "Combating Trafficking in Persons",
        type: "FAR",
      },
    ]);
    // SMALL sub at $200K (above $150K threshold so threshold doesn't apply first)
    const { mockDeps, mockMcp } = buildMocks({
      clauseRows: clauses,
      subRow: { ...SMALL_SUB_ROW, ceiling_value: "200000.00" },
    });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];

    const sbClause = matrix.find((e) => e.prime_clause === "52.219-8")!;
    expect(sbClause.flows_down).toBe(false);
    expect(sbClause.basis).toBe("EXEMPTED");
    expect(sbClause.notes).toContain("SMALL");

    // 52.222-50 still flows (no SB exemption)
    const mandClause = matrix.find((e) => e.prime_clause === "52.222-50")!;
    expect(mandClause.flows_down).toBe(true);
  });

  it("applies dollar threshold exemptions ($10K, $150K, $750K)", async () => {
    const clauses = makeClauseRows([
      { number: "52.222-26", title: "Equal Opportunity", type: "FAR" },
      {
        number: "52.222-35",
        title: "Equal Opportunity for Veterans",
        type: "FAR",
      },
      { number: "52.215-2", title: "Audit and Records", type: "FAR" },
    ]);
    // $8K sub — below all three thresholds ($10K, $150K, $750K)
    const { mockDeps, mockMcp } = buildMocks({
      clauseRows: clauses,
      subRow: LOW_VALUE_SUB_ROW,
    });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];

    expect(matrix).toHaveLength(3);
    for (const entry of matrix) {
      expect(entry.flows_down).toBe(false);
      expect(entry.basis).toBe("THRESHOLD");
      expect(entry.notes).toContain("8,000");
    }
  });

  it("applies CUI work filter for DFARS 252.204-7012", async () => {
    const clauses = makeClauseRows([
      {
        number: "252.204-7012",
        title: "Safeguarding Covered Defense Information",
        type: "DFARS",
      },
    ]);

    // Non-CUI sub — should NOT flow
    const { mockDeps: d1, mockMcp: m1 } = buildMocks({
      clauseRows: clauses,
      subRow: LARGE_SUB_ROW,
    });
    const agent1 = new FlowdownGeneratorAgent(d1, { mcp: m1 });
    const r1 = await agent1.execute(makeTask());
    const mx1 = r1.data!.matrix as unknown as FlowdownMatrixEntry[];
    expect(mx1[0]!.flows_down).toBe(false);
    expect(mx1[0]!.basis).toBe("NOT_APPLICABLE");
    expect(mx1[0]!.notes).toContain("CUI");

    // CUI sub — SHOULD flow
    const { mockDeps: d2, mockMcp: m2 } = buildMocks({
      clauseRows: clauses,
      subRow: CUI_SUB_ROW,
    });
    const agent2 = new FlowdownGeneratorAgent(d2, { mcp: m2 });
    const r2 = await agent2.execute(makeTask());
    const mx2 = r2.data!.matrix as unknown as FlowdownMatrixEntry[];
    expect(mx2[0]!.flows_down).toBe(true);
    expect(mx2[0]!.basis).toBe("MANDATORY");
  });

  it("produces complete flowdown matrix structure", async () => {
    const clauses = makeClauseRows([
      { number: "52.222-50", title: "Combating Trafficking", type: "FAR" },
      { number: "52.222-26", title: "Equal Opportunity", type: "FAR" },
      {
        number: "252.204-7012",
        title: "Safeguarding CUI",
        type: "DFARS",
      },
    ]);
    const { mockDeps, mockMcp } = buildMocks({ clauseRows: clauses });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];

    expect(matrix.length).toBeGreaterThan(0);
    for (const entry of matrix) {
      expect(entry).toHaveProperty("prime_clause");
      expect(entry).toHaveProperty("clause_title");
      expect(entry).toHaveProperty("clause_type");
      expect(typeof entry.flows_down).toBe("boolean");
      expect(["MANDATORY", "THRESHOLD", "EXEMPTED", "NOT_APPLICABLE"]).toContain(
        entry.basis,
      );
      expect(entry).toHaveProperty("modification_needed");
      expect(typeof entry.notes).toBe("string");
      expect(entry.notes.length).toBeGreaterThan(0);
    }
  });

  // ── Storage & output ───────────────────────────────────────────────

  it("creates flowdown_requirements records for each clause", async () => {
    const clauses = makeClauseRows([
      { number: "52.222-50", title: "Combating Trafficking", type: "FAR" },
      { number: "52.222-26", title: "Equal Opportunity", type: "FAR" },
    ]);
    const { mockDeps, mockMcp, queryCalls } = buildMocks({
      clauseRows: clauses,
    });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    await agent.execute(makeTask());

    const inserts = queryCalls.filter((q) =>
      q.sql.includes("INSERT INTO contracts.flowdown_requirements"),
    );
    expect(inserts).toHaveLength(2);

    // Both clauses flow at $500K LARGE → REQUIRED
    for (const ins of inserts) {
      expect(ins.params[1]).toBe(SUB_ID);
      expect(ins.params[2]).toBe("REQUIRED");
      expect(ins.params[3]).toBeNull(); // no waiver
    }
  });

  it("drafts modified clause language via LLM for flowing clauses", async () => {
    const clauses = makeClauseRows([
      { number: "52.222-50", title: "Combating Trafficking", type: "FAR" },
      {
        number: "252.204-7012",
        title: "Safeguarding CUI",
        type: "DFARS",
      },
    ]);
    const { mockDeps, mockMcp } = buildMocks({
      clauseRows: clauses,
      subRow: LARGE_SUB_ROW, // no CUI → 252.204-7012 won't flow
      llmResponses: [
        "The Subcontractor shall comply with all applicable provisions of the Trafficking Victims Protection Act as amended.",
      ],
    });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];

    // 52.222-50 flows → LLM called, draft applied
    const flowing = matrix.find((e) => e.prime_clause === "52.222-50")!;
    expect(flowing.flows_down).toBe(true);
    expect(flowing.modification_needed).toContain("Subcontractor");

    // 252.204-7012 does not flow → no LLM call
    const notFlowing = matrix.find(
      (e) => e.prime_clause === "252.204-7012",
    )!;
    expect(notFlowing.flows_down).toBe(false);
    expect(notFlowing.modification_needed).toBeNull();

    // LLM called only once (for the flowing clause)
    expect(mockDeps.llm.complete).toHaveBeenCalledTimes(1);
    expect(result.data!.draftLanguageCount).toBe(1);
  });

  it("generates Word document with flowdown matrix", async () => {
    const clauses = makeClauseRows([
      { number: "52.222-50", title: "Combating Trafficking", type: "FAR" },
    ]);
    const { mockDeps, mockMcp } = buildMocks({ clauseRows: clauses });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    await agent.execute(makeTask());

    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "microsoft.word.createDocument",
      expect.objectContaining({
        title: expect.stringContaining("Acme Defense Corp"),
        sections: expect.arrayContaining([
          expect.objectContaining({
            heading: "Flowdown Requirements Matrix",
          }),
          expect.objectContaining({
            heading: "Clause Flowdown Matrix",
            table: expect.objectContaining({
              headers: expect.arrayContaining([
                "Clause",
                "Title",
                "Flows Down",
                "Basis",
              ]),
            }),
          }),
        ]),
      }),
    );
  });

  it("creates Jira ticket with document attachment", async () => {
    const clauses = makeClauseRows([
      { number: "52.222-50", title: "Combating Trafficking", type: "FAR" },
    ]);
    const { mockDeps, mockMcp } = buildMocks({ clauseRows: clauses });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    expect(result.data!.jiraKey).toBe("FORGE-789");

    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "jira.createIssue",
      expect.objectContaining({
        project: "FORGE",
        issueType: "Review",
        summary: expect.stringContaining("FLOWDOWN"),
        description: expect.stringContaining(
          "Flowdown Matrix Review Required",
        ),
        fields: expect.objectContaining({
          labels: expect.arrayContaining(["flowdown-matrix"]),
          attachments: expect.arrayContaining([
            "https://sharepoint.example.com/docs/flowdown-matrix.docx",
          ]),
        }),
      }),
    );
  });

  // ── Complex scenarios ──────────────────────────────────────────────

  it("handles subcontractor with multiple exemptions", async () => {
    // SDVOSB sub at $5K — hits threshold, SB, and work-type exemptions
    const clauses = makeClauseRows([
      { number: "52.222-26", title: "Equal Opportunity", type: "FAR" },
      { number: "52.219-8", title: "SB Utilization", type: "FAR" },
      { number: "52.219-9", title: "SB Subcontracting Plan", type: "FAR" },
      { number: "252.204-7012", title: "Safeguarding CUI", type: "DFARS" },
      {
        number: "52.222-50",
        title: "Combating Trafficking",
        type: "FAR",
      },
    ]);
    const { mockDeps, mockMcp } = buildMocks({
      clauseRows: clauses,
      subRow: {
        ...LARGE_SUB_ROW,
        business_size: "SDVOSB",
        ceiling_value: "5000.00",
        sub_type: "Engineering Services",
        subcontractor_name: "VetTech LLC",
      },
    });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];

    // 52.222-26 ($10K threshold): $5K ≤ $10K → THRESHOLD exempt
    const eeo = matrix.find((e) => e.prime_clause === "52.222-26")!;
    expect(eeo.flows_down).toBe(false);
    expect(eeo.basis).toBe("THRESHOLD");

    // 52.219-8 ($150K threshold): $5K ≤ $150K → THRESHOLD (checked before SB)
    const sb8 = matrix.find((e) => e.prime_clause === "52.219-8")!;
    expect(sb8.flows_down).toBe(false);
    expect(sb8.basis).toBe("THRESHOLD");

    // 52.219-9 ($750K threshold): $5K ≤ $750K → THRESHOLD
    const sb9 = matrix.find((e) => e.prime_clause === "52.219-9")!;
    expect(sb9.flows_down).toBe(false);
    expect(sb9.basis).toBe("THRESHOLD");

    // 252.204-7012 (CUI): no CUI → NOT_APPLICABLE
    const cui = matrix.find((e) => e.prime_clause === "252.204-7012")!;
    expect(cui.flows_down).toBe(false);
    expect(cui.basis).toBe("NOT_APPLICABLE");

    // 52.222-50: mandatory, always flows regardless of size/value
    const traf = matrix.find((e) => e.prime_clause === "52.222-50")!;
    expect(traf.flows_down).toBe(true);
    expect(traf.basis).toBe("MANDATORY");
  });

  it("processes 30 clauses end-to-end with matrix and document", async () => {
    // 15 known FAR/DFARS clauses + 15 miscellaneous
    const knownClauses = [
      { number: "52.222-26", title: "Equal Opportunity", type: "FAR" },
      {
        number: "52.222-35",
        title: "EO for Veterans",
        type: "FAR",
      },
      {
        number: "52.222-36",
        title: "EO Workers w/ Disabilities",
        type: "FAR",
      },
      { number: "52.219-8", title: "SB Utilization", type: "FAR" },
      {
        number: "52.219-9",
        title: "SB Subcontracting Plan",
        type: "FAR",
      },
      { number: "52.215-2", title: "Audit and Records", type: "FAR" },
      {
        number: "52.222-41",
        title: "Service Contract Labor Standards",
        type: "FAR",
      },
      {
        number: "52.222-50",
        title: "Combating Trafficking",
        type: "FAR",
      },
      { number: "52.223-6", title: "Drug-Free Workplace", type: "FAR" },
      { number: "52.204-21", title: "Basic Safeguarding", type: "FAR" },
      {
        number: "252.204-7012",
        title: "Safeguarding CUI",
        type: "DFARS",
      },
      { number: "252.225-7001", title: "Buy American", type: "DFARS" },
      {
        number: "252.225-7048",
        title: "Export-Controlled Items",
        type: "DFARS",
      },
      {
        number: "252.227-7013",
        title: "Rights in Technical Data",
        type: "DFARS",
      },
      {
        number: "252.227-7014",
        title: "Rights in Computer Software",
        type: "DFARS",
      },
    ];

    // 15 misc clauses that won't match any rule
    const miscClauses = Array.from({ length: 15 }, (_, i) => ({
      number: `52.299-${i + 1}`,
      title: `Miscellaneous Clause ${i + 1}`,
      type: "FAR" as const,
    }));

    const allClauses = makeClauseRows([...knownClauses, ...miscClauses]);

    // LARGE sub at $500K, no CUI, no export
    const { mockDeps, mockMcp, queryCalls } = buildMocks({
      clauseRows: allClauses,
      llmResponses: ["VERBATIM"],
    });
    const agent = new FlowdownGeneratorAgent(mockDeps, { mcp: mockMcp });

    const result = await agent.execute(makeTask());
    expect(result.success).toBe(true);

    const matrix = result.data!.matrix as unknown as FlowdownMatrixEntry[];
    expect(matrix).toHaveLength(30);
    expect(result.data!.totalClauses).toBe(30);

    // At $500K LARGE:
    //   Flows: 52.222-26 (>$10K), 52.222-35 (>$150K), 52.222-36 (>$15K),
    //          52.219-8 (>$150K, LARGE), 52.222-41, 52.222-50, 52.223-6 (>$150K),
    //          52.204-21 (>$10K), 252.225-7001, 252.227-7013, 252.227-7014 → 11
    //   Threshold exempt: 52.219-9 ($750K), 52.215-2 ($750K) → 2
    //   Not applicable: 252.204-7012 (CUI), 252.225-7048 (export), 15 misc → 17
    const flowing = matrix.filter((e) => e.flows_down);
    const notFlowing = matrix.filter((e) => !e.flows_down);
    expect(flowing).toHaveLength(11);
    expect(notFlowing).toHaveLength(19);
    expect(result.data!.flowdownCount).toBe(11);
    expect(result.data!.exemptedCount).toBe(19);

    // Spot checks
    expect(
      matrix.find((e) => e.prime_clause === "52.222-50")!.flows_down,
    ).toBe(true);
    expect(
      matrix.find((e) => e.prime_clause === "52.219-9")!.flows_down,
    ).toBe(false);
    expect(
      matrix.find((e) => e.prime_clause === "252.204-7012")!.flows_down,
    ).toBe(false);
    expect(
      matrix.find((e) => e.prime_clause === "52.299-1")!.flows_down,
    ).toBe(false);

    // All VERBATIM → draftLanguageCount = 0
    expect(result.data!.draftLanguageCount).toBe(0);

    // 30 flowdown_requirements inserts
    const inserts = queryCalls.filter((q) =>
      q.sql.includes("INSERT INTO contracts.flowdown_requirements"),
    );
    expect(inserts).toHaveLength(30);

    // Word document generated
    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "microsoft.word.createDocument",
      expect.anything(),
    );

    // Jira ticket created
    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "jira.createIssue",
      expect.anything(),
    );
  });
});
