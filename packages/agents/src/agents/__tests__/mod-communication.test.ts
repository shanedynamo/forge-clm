import { describe, it, expect, vi } from "vitest";
import {
  ModCommunicationAgent,
  parseModReferences,
  parseClassificationResponse,
  calculateResponseDueDate,
  type InboundEmail,
  type ModCommunicationPayload,
  type SF30Fields,
  type OverdueAlert,
} from "../mod-communication.js";
import type {
  AgentTask,
  AgentDependencies,
} from "../../framework/base-agent.js";
import { ArcadeClient } from "../../mcp/arcade-client.js";

// ─── Constants ───────────────────────────────────────────────────────

const NOW = new Date("2024-07-15T12:00:00Z");
const CONTRACT_ID = "contract-001";
const MOD_ID = "mod-001";
const CONTRACT_NUMBER = "W56HZV-24-C-0001";
const MOD_NUMBER = "P00003";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTask(payload: ModCommunicationPayload): AgentTask {
  return {
    id: "task-modcomm-001",
    agentName: "mod-communication",
    triggerType: "EVENT",
    priority: "MEDIUM",
    createdAt: NOW,
    triggerPayload: payload as unknown as Record<string, unknown>,
  };
}

function makeEmail(overrides?: Partial<InboundEmail>): InboundEmail {
  return {
    from: "john.smith@army.mil",
    to: "contracts@dynamo.com",
    subject: `Contract ${CONTRACT_NUMBER} — Modification ${MOD_NUMBER}`,
    body: `Please find attached the proposed modification ${MOD_NUMBER} to contract ${CONTRACT_NUMBER}. This modification increases the ceiling by $150,000 for additional engineering support.`,
    receivedAt: "2024-07-10T09:00:00Z",
    s3Key: "emails/mod-notification-001.eml",
    ...overrides,
  };
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

function buildMocks(opts?: {
  llmResponses?: string[];
  modRows?: unknown[];
  commRows?: unknown[];
  overdueModRows?: unknown[];
}) {
  const queryCalls: QueryCall[] = [];
  let llmIdx = 0;
  const llmResponses = opts?.llmResponses ?? [
    '{"type":"INITIAL_NOTIFICATION","confidence":0.95}',
  ];

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

        // Resolve contract by number
        if (
          sql.includes("contracts.contracts") &&
          sql.includes("contract_number = $1")
        ) {
          return [{ id: CONTRACT_ID }];
        }
        // Overdue check: mods in review/submitted (check BEFORE generic mod queries)
        if (
          sql.includes("MOD_UNDER_REVIEW") &&
          sql.includes("MOD_SUBMITTED")
        ) {
          return opts?.overdueModRows ?? [];
        }
        // Resolve mod by contract_id + mod_number
        if (
          sql.includes("contracts.modifications") &&
          sql.includes("mod_number")
        ) {
          if (sql.includes("contract_id = $1 AND mod_number = $2")) {
            return [{ id: MOD_ID }];
          }
          // Draft response: full mod details
          return (
            opts?.modRows ?? [
              {
                mod_number: MOD_NUMBER,
                mod_type: "BILATERAL",
                effective_date: "2024-08-01",
                description: "Additional engineering support",
                ceiling_delta: "150000.00",
                funding_delta: "100000.00",
                sf30_reference: "SF30-2024-001",
              },
            ]
          );
        }
        // Latest inbound comm for draft
        if (
          sql.includes("communications_log") &&
          sql.includes("direction = 'INBOUND'") &&
          sql.includes("ORDER BY")
        ) {
          return (
            opts?.commRows ?? [
              {
                subject: `Modification ${MOD_NUMBER}`,
                body_preview: "Proposed ceiling increase.",
                from_party: "john.smith@army.mil",
                received_at: "2024-07-10T09:00:00Z",
              },
            ]
          );
        }
        // CO lookup
        if (
          sql.includes("contracting_officer_name") &&
          sql.includes("contracts.contracts")
        ) {
          return [{ contracting_officer_name: "John Smith" }];
        }
        // INSERT statements
        if (sql.includes("INSERT")) {
          return [];
        }
        return [];
      }),
      getContractContext: vi.fn(async () => ({
        contractId: CONTRACT_ID,
        contractNumber: CONTRACT_NUMBER,
        status: "ACTIVE",
        contractType: "CPFF",
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
  vi.spyOn(mockMcp, "executeTool").mockImplementation(async () => ({
    success: true,
    data: {},
  }));

  return { mockDeps, mockMcp, queryCalls };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("ModCommunicationAgent", () => {
  it("parses CO notification email to identify contract and mod", async () => {
    const { mockDeps, mockMcp } = buildMocks();
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    const result = await agent.execute(
      makeTask({ emailContent: makeEmail() }),
    );

    expect(result.success).toBe(true);
    expect(result.data!.contractNumber).toBe(CONTRACT_NUMBER);
    expect(result.data!.modNumber).toBe(MOD_NUMBER);
    expect(result.data!.contractId).toBe(CONTRACT_ID);
    expect(result.data!.modId).toBe(MOD_ID);
  });

  it("classifies communication types correctly", async () => {
    // Test the three main types via different LLM responses
    const cases: Array<{ llm: string; expected: string }> = [
      {
        llm: '{"type":"INITIAL_NOTIFICATION","confidence":0.95}',
        expected: "INITIAL_NOTIFICATION",
      },
      {
        llm: '{"type":"COUNTER_PROPOSAL","confidence":0.88}',
        expected: "COUNTER_PROPOSAL",
      },
      {
        llm: '{"type":"ACCEPTANCE","confidence":0.92}',
        expected: "ACCEPTANCE",
      },
    ];

    for (const { llm, expected } of cases) {
      const { mockDeps, mockMcp } = buildMocks({
        llmResponses: [llm],
      });
      const agent = new ModCommunicationAgent(mockDeps, {
        mcp: mockMcp,
        now: NOW,
      });

      const result = await agent.execute(
        makeTask({ emailContent: makeEmail() }),
      );
      expect(result.data!.classificationType).toBe(expected);
    }
  });

  it("calculates response due date correctly", () => {
    const received = "2024-07-10T09:00:00Z";

    // Default 30 days
    const due30 = calculateResponseDueDate(received, 30);
    expect(due30.toISOString()).toBe("2024-08-09T09:00:00.000Z");

    // Custom 14 days
    const due14 = calculateResponseDueDate(received, 14);
    expect(due14.toISOString()).toBe("2024-07-24T09:00:00.000Z");

    // Returned in agent result
    const { mockDeps, mockMcp } = buildMocks();
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
      config: { responseDueDays: 30 },
    });

    // The email was received July 10 → due Aug 9
    agent.execute(makeTask({ emailContent: makeEmail() })).then((result) => {
      expect(result.data!.responseDueDate).toBe("2024-08-09T09:00:00.000Z");
    });
  });

  it("detects overdue responses at 7-day threshold", async () => {
    // Mod received 25 days ago → 5 days remaining (within 7-day WARNING)
    const receivedDate = new Date(
      NOW.getTime() - 25 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { mockDeps, mockMcp } = buildMocks({
      overdueModRows: [
        {
          id: MOD_ID,
          mod_number: MOD_NUMBER,
          status: "MOD_UNDER_REVIEW",
          contract_number: CONTRACT_NUMBER,
          received_at: receivedDate,
        },
      ],
    });
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
      config: { responseDueDays: 30 },
    });

    const result = await agent.execute(
      makeTask({ scheduledCheck: true }),
    );

    expect(result.success).toBe(true);
    expect(result.data!.alertCount).toBe(1);

    const alerts = result.data!.alerts as unknown as OverdueAlert[];
    expect(alerts[0]!.severity).toBe("WARNING");
    expect(alerts[0]!.daysRemaining).toBe(5);
    expect(alerts[0]!.modNumber).toBe(MOD_NUMBER);
  });

  it("drafts response via LLM with contract context", async () => {
    const draftText =
      "Dear Mr. Smith,\n\nReference: Contract W56HZV-24-C-0001, Modification P00003\n\nDynamo Technologies acknowledges receipt of the proposed modification...";

    const { mockDeps, mockMcp, queryCalls } = buildMocks({
      llmResponses: [draftText],
    });
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    const result = await agent.execute(
      makeTask({
        draftResponse: { modId: MOD_ID, contractId: CONTRACT_ID },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data!.draftText).toContain("Dynamo Technologies");
    expect(result.data!.modNumber).toBe(MOD_NUMBER);

    // Verify LLM was called with contract context
    const llmCall = (mockDeps.llm.complete as any).mock.calls[0]![0] as string;
    expect(llmCall).toContain(CONTRACT_NUMBER);
    expect(llmCall).toContain("CPFF");
    expect(llmCall).toContain(MOD_NUMBER);
  });

  it("pre-populates SF-30 fields from extracted data", async () => {
    const { mockDeps, mockMcp } = buildMocks({
      llmResponses: ["Draft response text here."],
    });
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    const result = await agent.execute(
      makeTask({
        draftResponse: { modId: MOD_ID, contractId: CONTRACT_ID },
      }),
    );

    const sf30 = result.data!.sf30 as unknown as SF30Fields;
    expect(sf30.contractNumber).toBe(CONTRACT_NUMBER);
    expect(sf30.modNumber).toBe(MOD_NUMBER);
    expect(sf30.effectiveDate).toBe("2024-08-01");
    expect(sf30.contractingOfficer).toBe("John Smith");
    expect(sf30.contractor).toBe("Dynamo Technologies, Inc.");
    expect(sf30.ceilingDelta).toBe("150000.00");
    expect(sf30.fundingDelta).toBe("100000.00");
  });

  it("updates FSM state on communication receipt", async () => {
    // INITIAL_NOTIFICATION → should transition to MOD_ANALYSIS
    const { mockDeps, mockMcp } = buildMocks({
      llmResponses: ['{"type":"INITIAL_NOTIFICATION","confidence":0.95}'],
    });
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    const result = await agent.execute(
      makeTask({ emailContent: makeEmail() }),
    );

    expect(result.data!.fsmTransitioned).toBe(true);
    expect(mockDeps.fsm.transition).toHaveBeenCalledWith(
      "MODIFICATION",
      MOD_ID,
      "MOD_ANALYSIS",
      "system",
      "system",
    );
  });

  it("creates communications_log entries", async () => {
    const { mockDeps, mockMcp, queryCalls } = buildMocks();
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    await agent.execute(makeTask({ emailContent: makeEmail() }));

    const inserts = queryCalls.filter(
      (q) =>
        q.sql.includes("INSERT INTO contracts.communications_log"),
    );
    expect(inserts).toHaveLength(1);

    const ins = inserts[0]!;
    expect(ins.params[0]).toBe(CONTRACT_ID); // contract_id
    expect(ins.params[1]).toBe(MOD_ID); // mod_id
    expect(ins.params[2]).toBe("INBOUND"); // direction
    expect(ins.params[3]).toBe("EMAIL"); // channel
    expect(ins.params[4]).toBe("john.smith@army.mil"); // from_party
    expect(ins.params[5]).toBe("contracts@dynamo.com"); // to_party
    expect((ins.params[6] as string)).toContain(CONTRACT_NUMBER); // subject
  });

  it("sends Teams alert on new mod communication", async () => {
    const { mockDeps, mockMcp } = buildMocks();
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    await agent.execute(makeTask({ emailContent: makeEmail() }));

    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "microsoft.teams.sendMessage",
      expect.objectContaining({
        channelId: "contracts-modifications",
        message: expect.stringContaining("New Modification Communication"),
      }),
    );

    // Verify message includes key details
    const call = (mockMcp.executeTool as any).mock.calls.find(
      (c: any[]) => c[0] === "microsoft.teams.sendMessage",
    )!;
    const msg = call[1].message as string;
    expect(msg).toContain(CONTRACT_NUMBER);
    expect(msg).toContain(MOD_NUMBER);
    expect(msg).toContain("INITIAL NOTIFICATION");
  });

  it("handles end-to-end mod communication lifecycle", async () => {
    // Step 1: Receive initial notification
    const { mockDeps, mockMcp, queryCalls } = buildMocks({
      llmResponses: [
        // Classification for inbound email
        '{"type":"INITIAL_NOTIFICATION","confidence":0.95}',
        // Draft response text
        "Dear Mr. Smith,\n\nDynamo Technologies acknowledges receipt of Modification P00003 to Contract W56HZV-24-C-0001. We accept the proposed terms.\n\nSincerely,\nContracts Team",
      ],
    });
    const agent = new ModCommunicationAgent(mockDeps, {
      mcp: mockMcp,
      now: NOW,
    });

    // Receive email
    const emailResult = await agent.execute(
      makeTask({ emailContent: makeEmail() }),
    );
    expect(emailResult.success).toBe(true);
    expect(emailResult.data!.classificationType).toBe(
      "INITIAL_NOTIFICATION",
    );
    expect(emailResult.data!.fsmTransitioned).toBe(true);

    // Verify comm log entry created
    const emailInserts = queryCalls.filter(
      (q) =>
        q.sql.includes("INSERT INTO contracts.communications_log") &&
        q.params.includes("INBOUND"),
    );
    expect(emailInserts).toHaveLength(1);

    // Step 2: Draft response
    const draftResult = await agent.execute(
      makeTask({
        draftResponse: { modId: MOD_ID, contractId: CONTRACT_ID },
      }),
    );
    expect(draftResult.success).toBe(true);
    expect(draftResult.data!.draftText).toContain("Dynamo Technologies");

    // Verify SF-30 populated
    const sf30 = draftResult.data!.sf30 as unknown as SF30Fields;
    expect(sf30.contractNumber).toBe(CONTRACT_NUMBER);
    expect(sf30.modNumber).toBe(MOD_NUMBER);

    // Verify outbound comm log entry
    const outboundInserts = queryCalls.filter(
      (q) =>
        q.sql.includes("INSERT INTO contracts.communications_log") &&
        q.params.includes("OUTBOUND"),
    );
    expect(outboundInserts).toHaveLength(1);

    // Verify Teams notification sent for inbound
    expect(mockMcp.executeTool).toHaveBeenCalledWith(
      "microsoft.teams.sendMessage",
      expect.objectContaining({
        message: expect.stringContaining("New Modification Communication"),
      }),
    );
  });
});

// ─── Unit tests for exported helpers ─────────────────────────────────

describe("parseModReferences", () => {
  it("extracts contract and mod numbers from email text", () => {
    const result = parseModReferences(
      "RE: Contract W56HZV-24-C-0001 Mod P00003",
      "Body text here",
    );
    expect(result.contractNumber).toBe("W56HZV-24-C-0001");
    expect(result.modNumber).toBe("P00003");
  });

  it("handles mod number in body when not in subject", () => {
    const result = parseModReferences(
      "Contract Modification Notice",
      "Reference contract FA8732-23-D-0042, modification A00001.",
    );
    expect(result.contractNumber).toBe("FA8732-23-D-0042");
    expect(result.modNumber).toBe("A00001");
  });

  it("returns null when no references found", () => {
    const result = parseModReferences(
      "Meeting reminder",
      "See you at 3pm.",
    );
    expect(result.contractNumber).toBeNull();
    expect(result.modNumber).toBeNull();
  });
});

describe("parseClassificationResponse", () => {
  it("parses valid JSON response", () => {
    const r = parseClassificationResponse(
      '{"type":"COUNTER_PROPOSAL","confidence":0.88}',
    );
    expect(r.type).toBe("COUNTER_PROPOSAL");
    expect(r.confidence).toBe(0.88);
  });

  it("strips markdown code fences", () => {
    const r = parseClassificationResponse(
      '```json\n{"type":"ACCEPTANCE","confidence":0.92}\n```',
    );
    expect(r.type).toBe("ACCEPTANCE");
  });

  it("defaults to INITIAL_NOTIFICATION for unknown types", () => {
    const r = parseClassificationResponse(
      '{"type":"UNKNOWN","confidence":0.5}',
    );
    expect(r.type).toBe("INITIAL_NOTIFICATION");
  });
});
