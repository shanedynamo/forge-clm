/**
 * Abstract base agent that all Forge agents inherit from.
 *
 * Provides built-in capabilities: LLM, vector search, DB queries,
 * contract context, audit logging, and FSM integration.
 */

import type { EntityType, FsmRole, TransitionDef } from "@forge/shared";

// ─── Types ───────────────────────────────────────────────────────────

export interface AgentTask {
  id: string;
  agentName: string;
  triggerType: "EVENT" | "SCHEDULE" | "MANUAL";
  triggerPayload: Record<string, unknown>;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  createdAt: Date;
}

export interface AgentResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  needsReview?: boolean;
  reviewReason?: string;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface SearchOpts {
  contractId?: string;
  sectionType?: string;
  limit?: number;
}

export interface SearchResult {
  chunkId: string;
  chunkText: string;
  similarityScore: number;
  contractId: string;
  sectionType: string;
  clauseNumber: string | null;
}

export interface ContractContext {
  contractId: string;
  contractNumber: string;
  status: string;
  contractType: string;
  ceilingValue: string;
  fundedValue: string;
  awardingAgency: string;
  popStart: string;
  popEnd: string;
}

export interface Transition {
  to: string;
  requiredRole: FsmRole;
}

// ─── Provider interfaces (injectable for testing) ────────────────────

export interface LLMProvider {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface VectorSearchProvider {
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]>;
}

export interface DatabaseProvider {
  query(sql: string, params: unknown[]): Promise<unknown[]>;
  getContractContext(contractId: string): Promise<ContractContext>;
}

export interface AuditProvider {
  log(entry: {
    agentType: string;
    taskId: string;
    status: string;
    inputSummary: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
    tokensUsed?: number;
    errorDetails?: string;
  }): Promise<void>;
}

export interface FsmProvider {
  transition(
    entityType: string,
    entityId: string,
    toState: string,
    userId: string,
    role: FsmRole,
  ): Promise<string>;
  getAvailableTransitions(
    entityType: string,
    entityId: string,
    role: FsmRole,
  ): Promise<Transition[]>;
}

export interface AgentDependencies {
  llm: LLMProvider;
  vectorSearch: VectorSearchProvider;
  database: DatabaseProvider;
  audit: AuditProvider;
  fsm: FsmProvider;
}

// ─── Abstract base class ─────────────────────────────────────────────

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly type: string;
  abstract readonly description: string;

  protected deps: AgentDependencies;

  constructor(deps: AgentDependencies) {
    this.deps = deps;
  }

  /** Execute the agent's main task logic. */
  abstract execute(task: AgentTask): Promise<AgentResult>;

  // ─── Built-in capabilities ───────────────────────────────────────

  protected async callLLM(prompt: string, options?: LLMOptions): Promise<string> {
    return this.deps.llm.complete(prompt, options);
  }

  protected async searchVectors(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    return this.deps.vectorSearch.search(query, opts);
  }

  protected async queryDatabase(sql: string, params: unknown[]): Promise<unknown[]> {
    return this.deps.database.query(sql, params);
  }

  protected async getContractContext(contractId: string): Promise<ContractContext> {
    return this.deps.database.getContractContext(contractId);
  }

  protected async log(level: string, message: string, data?: unknown): void {
    // In production, this would use a structured logger (pino/winston)
    const prefix = `[${this.name}] [${level.toUpperCase()}]`;
    if (data) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  protected async createAuditEntry(
    taskId: string,
    status: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.log({
      agentType: this.type,
      taskId,
      status,
      inputSummary: details.input as Record<string, unknown> ?? {},
      outputSummary: details.output as Record<string, unknown>,
      tokensUsed: details.tokensUsed as number,
      errorDetails: details.error as string,
    });
  }

  // ─── FSM integration ─────────────────────────────────────────────

  protected async transitionState(
    entityType: string,
    entityId: string,
    toState: string,
    userId: string = "system",
    role: FsmRole = "system",
  ): Promise<void> {
    await this.deps.fsm.transition(entityType, entityId, toState, userId, role);
  }

  protected async getAvailableTransitions(
    entityType: string,
    entityId: string,
    role: FsmRole = "system",
  ): Promise<Transition[]> {
    return this.deps.fsm.getAvailableTransitions(entityType, entityId, role);
  }
}
