import { describe, it, expect, vi } from "vitest";
import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
  type LLMProvider,
  type VectorSearchProvider,
  type DatabaseProvider,
  type AuditProvider,
  type FsmProvider,
} from "../base-agent.js";

// ─── TestAgent: concrete implementation ──────────────────────────────

class TestAgent extends BaseAgent {
  readonly name = "test-agent";
  readonly type = "test";
  readonly description = "A test agent for unit testing";

  async execute(task: AgentTask): Promise<AgentResult> {
    // Use built-in capabilities so tests can verify delegation
    const llmResult = await this.callLLM("Analyze this contract");
    const searchResults = await this.searchVectors("intellectual property");
    const context = await this.getContractContext("contract-123");
    await this.createAuditEntry(task.id, "RUNNING", { input: task.triggerPayload });
    await this.transitionState("PRIME_CONTRACT", "entity-1", "ACTIVE");

    return {
      success: true,
      data: {
        llmResult,
        searchCount: searchResults.length,
        contractNumber: context.contractNumber,
      },
    };
  }
}

// ─── Mock dependencies ───────────────────────────────────────────────

function createMockDeps(): AgentDependencies {
  return {
    llm: {
      complete: vi.fn().mockResolvedValue("LLM response: approved"),
    },
    vectorSearch: {
      search: vi.fn().mockResolvedValue([
        {
          chunkId: "chunk-1",
          chunkText: "IP rights clause",
          similarityScore: 0.95,
          contractId: "c-1",
          sectionType: "SECTION_H",
          clauseNumber: "52.227-14",
        },
        {
          chunkId: "chunk-2",
          chunkText: "Data rights provision",
          similarityScore: 0.89,
          contractId: "c-1",
          sectionType: "SECTION_H",
          clauseNumber: null,
        },
      ]),
    },
    database: {
      query: vi.fn().mockResolvedValue([]),
      getContractContext: vi.fn().mockResolvedValue({
        contractId: "contract-123",
        contractNumber: "FA8726-24-C-0042",
        status: "ACTIVE",
        contractType: "FFP",
        ceilingValue: "12500000.00",
        fundedValue: "5000000.00",
        awardingAgency: "US Air Force",
        popStart: "2024-01-01",
        popEnd: "2025-12-31",
      }),
    },
    audit: {
      log: vi.fn().mockResolvedValue(undefined),
    },
    fsm: {
      transition: vi.fn().mockResolvedValue("ACTIVE"),
      getAvailableTransitions: vi.fn().mockResolvedValue([
        { to: "CLOSEOUT_PENDING", requiredRole: "contracts_manager" },
      ]),
    },
  };
}

function createTask(): AgentTask {
  return {
    id: "task-001",
    agentName: "test-agent",
    triggerType: "EVENT",
    triggerPayload: { contractId: "contract-123", event: "contract.ingested" },
    priority: "HIGH",
    createdAt: new Date(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("BaseAgent", () => {
  it("execute() is called with proper AgentTask and returns AgentResult", async () => {
    const deps = createMockDeps();
    const agent = new TestAgent(deps);
    const task = createTask();

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.llmResult).toBe("LLM response: approved");
    expect(result.data!.searchCount).toBe(2);
    expect(result.data!.contractNumber).toBe("FA8726-24-C-0042");
  });

  it("callLLM delegates to LLM provider", async () => {
    const deps = createMockDeps();
    const agent = new TestAgent(deps);

    await agent.execute(createTask());

    expect(deps.llm.complete).toHaveBeenCalledWith(
      "Analyze this contract",
      undefined,
    );
  });

  it("searchVectors delegates to VectorSearchService", async () => {
    const deps = createMockDeps();
    const agent = new TestAgent(deps);

    await agent.execute(createTask());

    expect(deps.vectorSearch.search).toHaveBeenCalledWith(
      "intellectual property",
      undefined,
    );
  });

  it("createAuditEntry writes to the audit log", async () => {
    const deps = createMockDeps();
    const agent = new TestAgent(deps);

    await agent.execute(createTask());

    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: "test",
        taskId: "task-001",
        status: "RUNNING",
      }),
    );
  });

  it("transitionState delegates to FSM service", async () => {
    const deps = createMockDeps();
    const agent = new TestAgent(deps);

    await agent.execute(createTask());

    expect(deps.fsm.transition).toHaveBeenCalledWith(
      "PRIME_CONTRACT",
      "entity-1",
      "ACTIVE",
      "system",
      "system",
    );
  });

  it("getAvailableTransitions delegates to FSM service", async () => {
    const deps = createMockDeps();
    const agent = new TestAgent(deps);

    // Access through a custom agent that exposes this
    class TransitionQueryAgent extends BaseAgent {
      readonly name = "query-agent";
      readonly type = "test";
      readonly description = "Test";
      async execute(task: AgentTask): Promise<AgentResult> {
        const transitions = await this.getAvailableTransitions("PRIME_CONTRACT", "e-1");
        return { success: true, data: { transitions } };
      }
    }

    const queryAgent = new TransitionQueryAgent(deps);
    const result = await queryAgent.execute(createTask());

    expect(deps.fsm.getAvailableTransitions).toHaveBeenCalledWith(
      "PRIME_CONTRACT",
      "e-1",
      "system",
    );
    expect(result.data!.transitions).toHaveLength(1);
  });
});
