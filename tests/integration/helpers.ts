/**
 * Shared integration test helpers.
 *
 * Provides DB connection, schema setup/teardown, and mock provider factories
 * for running agent workflows against the Docker Compose test stack.
 */

import { vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type {
  AgentDependencies,
  LLMProvider,
  VectorSearchProvider,
  DatabaseProvider,
  AuditProvider,
  FsmProvider,
  AgentTask,
  ContractContext,
  SearchResult,
} from "@forge/agents";

// ─── DB connection ──────────────────────────────────────────────────

export const TEST_DB_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://forge:forge@localhost:5433/forge_test";

export function connectTestDb(maxConnections = 5) {
  const client = postgres(TEST_DB_URL, { max: maxConnections });
  const db = drizzle(client);
  return { client, db };
}

export async function setupSchema(client: ReturnType<typeof postgres>) {
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  const migrationsPath = new URL(
    "../../packages/api/src/db/migrations",
    import.meta.url,
  ).pathname;
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: migrationsPath });
}

export async function cleanTables(client: ReturnType<typeof postgres>) {
  await client.unsafe("SET session_replication_role = 'replica'");
  await client.unsafe("DELETE FROM contracts.flowdown_requirements");
  await client.unsafe("DELETE FROM contracts.compliance_milestones");
  await client.unsafe("DELETE FROM contracts.contract_clauses");
  await client.unsafe("DELETE FROM contracts.contract_options");
  await client.unsafe("DELETE FROM contracts.deliverables");
  await client.unsafe("DELETE FROM contracts.government_property");
  await client.unsafe("DELETE FROM contracts.small_business_plans");
  await client.unsafe("DELETE FROM contracts.communications_log");
  await client.unsafe("DELETE FROM contracts.approval_queue");
  await client.unsafe("DELETE FROM contracts.contract_requests");
  await client.unsafe("DELETE FROM contracts.modifications");
  await client.unsafe("DELETE FROM contracts.subcontracts");
  await client.unsafe("DELETE FROM contracts.clins");
  await client.unsafe("DELETE FROM contracts.mou_parties");
  await client.unsafe("DELETE FROM contracts.mous");
  await client.unsafe("DELETE FROM contracts.ndas");
  await client.unsafe("DELETE FROM contracts.parties");
  await client.unsafe("DELETE FROM contracts.contracts");
  await client.unsafe("DELETE FROM audit.agent_execution_log");
  await client.unsafe("DELETE FROM audit.audit_log");
  await client.unsafe("DELETE FROM agents.agent_context");
  await client.unsafe("DELETE FROM agents.agent_tasks");
  await client.unsafe("DELETE FROM agents.playbook_rules");
  await client.unsafe("DELETE FROM agents.agent_registry");
  await client.unsafe("DELETE FROM vectors.entity_annotations");
  await client.unsafe("DELETE FROM vectors.document_chunks");
  await client.unsafe("DELETE FROM vectors.clause_embeddings");
  await client.unsafe("SET session_replication_role = 'origin'");
}

export async function teardownSchema(client: ReturnType<typeof postgres>) {
  await client.end();
}

// ─── Provider factories ─────────────────────────────────────────────

/** Real DatabaseProvider that wraps a postgres client for live SQL. */
export function createDbProvider(
  client: ReturnType<typeof postgres>,
): DatabaseProvider {
  return {
    async query(sql: string, params: unknown[]): Promise<unknown[]> {
      return client.unsafe(sql, params as any[]);
    },
    async getContractContext(contractId: string): Promise<ContractContext> {
      const rows = await client.unsafe(
        `SELECT id, contract_number, status, contract_type,
                ceiling_value, funded_value, awarding_agency,
                pop_start, pop_end
         FROM contracts.contracts WHERE id = $1`,
        [contractId],
      );
      if (rows.length === 0) throw new Error(`Contract not found: ${contractId}`);
      const r = rows[0] as any;
      return {
        contractId: r.id,
        contractNumber: r.contract_number,
        status: r.status,
        contractType: r.contract_type,
        ceilingValue: r.ceiling_value,
        fundedValue: r.funded_value,
        awardingAgency: r.awarding_agency,
        popStart: r.pop_start,
        popEnd: r.pop_end,
      };
    },
  };
}

/** Real AuditProvider that writes to the audit.agent_execution_log table. */
export function createAuditProvider(
  client: ReturnType<typeof postgres>,
): AuditProvider {
  return {
    async log(entry) {
      await client.unsafe(
        `INSERT INTO audit.agent_execution_log
         (agent_type, task_id, started_at, status, input_summary, output_summary, tokens_used, error_details)
         VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)`,
        [
          entry.agentType,
          entry.taskId,
          entry.status,
          JSON.stringify(entry.inputSummary),
          entry.outputSummary ? JSON.stringify(entry.outputSummary) : null,
          entry.tokensUsed ?? null,
          entry.errorDetails ?? null,
        ],
      );
    },
  };
}

/** Mock LLM provider — returns a canned response per call. */
export function createMockLlm(responses: string[]): LLMProvider {
  let idx = 0;
  return {
    complete: vi.fn(async () => {
      const response = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      return response;
    }),
  };
}

/** Mock VectorSearchProvider — returns canned search results. */
export function createMockVectorSearch(
  results: SearchResult[] = [],
): VectorSearchProvider {
  return {
    search: vi.fn(async () => results),
  };
}

/** Mock FsmProvider — tracks calls but doesn't enforce transitions. */
export function createMockFsm(): FsmProvider {
  return {
    transition: vi.fn(async (_entityType, _entityId, toState) => toState),
    getAvailableTransitions: vi.fn(async () => []),
  };
}

// ─── Task factory ───────────────────────────────────────────────────

export function createTask(
  agentName: string,
  payload: Record<string, unknown>,
  overrides?: Partial<AgentTask>,
): AgentTask {
  return {
    id: crypto.randomUUID(),
    agentName,
    triggerType: "EVENT",
    triggerPayload: payload,
    priority: "MEDIUM",
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Utility ────────────────────────────────────────────────────────

/** Generate a fake 768-dim embedding vector for testing. */
export function fakeEmbedding(): number[] {
  return Array.from({ length: 768 }, () => Math.random() * 2 - 1);
}

/** Insert a contract directly and return its id. */
export async function seedContract(
  client: ReturnType<typeof postgres>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const num = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const defaults: Record<string, unknown> = {
    contract_number: num,
    contract_type: "FFP",
    awarding_agency: "Test Agency",
    contracting_officer_name: "Test CO",
    contracting_officer_email: "co@test.gov",
    pop_start: "2025-01-01",
    pop_end: "2026-12-31",
    ceiling_value: "5000000.00",
    funded_value: "3000000.00",
    status: "ACTIVE",
  };
  const merged = { ...defaults, ...overrides };
  const cols = Object.keys(merged);
  const vals = Object.values(merged);
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");

  const rows = await client.unsafe(
    `INSERT INTO contracts.contracts (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    vals as any[],
  );
  return (rows[0] as any).id;
}
