/**
 * Contract Ingestion Agent
 *
 * Processes new or modified documents from S3 via the NLP pipeline,
 * populates the database, diffs clauses on modifications,
 * and triggers downstream agents.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
} from "../framework/base-agent.js";
import { ArcadeClient } from "../mcp/arcade-client.js";
import { ClauseDiffer, type Clause, type ClauseDiff } from "./helpers/clause-differ.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface S3EventPayload {
  bucket: string;
  key: string;
  eventType: "created" | "modified";
}

export interface ContractMetadata {
  contract_number: string | null;
  ceiling_value: string | null;
  funded_value: string | null;
  pop_start: string | null;
  pop_end: string | null;
  naics_code: string | null;
  psc_code: string | null;
  security_level: string | null;
  cage_code: string | null;
  uei_number: string | null;
  contracting_officer_name: string | null;
  far_clauses: string[];
  dfars_clauses: string[];
}

export interface QualityIssue {
  severity: "INFO" | "WARNING" | "ERROR";
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface QualityReport {
  issues: QualityIssue[];
  needs_human_review: boolean;
  review_reasons: string[];
  entity_count: number;
  chunk_count: number;
}

export interface IngestionResultData {
  contract_id: string;
  s3_key: string;
  document_type: string;
  text_length: number;
  chunk_count: number;
  entity_count: number;
  chunks_stored: number;
  annotations_stored: number;
  metadata: ContractMetadata;
  duration_ms: number;
}

export interface IngestionResponse {
  result: IngestionResultData;
  quality: QualityReport;
}

/** Downstream agent trigger. */
export interface AgentTrigger {
  agentName: string;
  payload: Record<string, unknown>;
}

export interface ContractIngestionConfig {
  nlpBaseUrl?: string;
  jiraProject?: string;
  teamsChannelId?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

// ─── Supported document types ────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set(["docx", "pdf"]);

function getDocumentType(key: string): "docx" | "pdf" | null {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext && SUPPORTED_EXTENSIONS.has(ext)) return ext as "docx" | "pdf";
  return null;
}

// ─── NLP pipeline client ─────────────────────────────────────────────

export interface NlpPipelineClient {
  ingest(s3Key: string, documentType: "docx" | "pdf"): Promise<IngestionResponse>;
}

export class HttpNlpPipelineClient implements NlpPipelineClient {
  constructor(private readonly baseUrl: string = "http://localhost:8000") {}

  async ingest(s3Key: string, documentType: "docx" | "pdf"): Promise<IngestionResponse> {
    const response = await fetch(`${this.baseUrl}/pipeline/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key: s3Key, document_type: documentType }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`NLP service returned ${response.status}: ${body}`);
    }

    return response.json();
  }
}

// ─── Agent ───────────────────────────────────────────────────────────

export class ContractIngestionAgent extends BaseAgent {
  readonly name = "contract-ingestion";
  readonly type = "ingestion";
  readonly description =
    "Processes documents from S3 through the NLP pipeline, populates the database, and triggers downstream agents";

  private readonly mcp: ArcadeClient;
  private readonly nlp: NlpPipelineClient;
  private readonly differ: ClauseDiffer;
  private readonly config: Required<ContractIngestionConfig>;

  constructor(
    deps: AgentDependencies,
    options?: {
      mcp?: ArcadeClient;
      nlp?: NlpPipelineClient;
      config?: ContractIngestionConfig;
    },
  ) {
    super(deps);
    this.mcp = options?.mcp ?? new ArcadeClient();
    this.nlp = options?.nlp ?? new HttpNlpPipelineClient(options?.config?.nlpBaseUrl);
    this.differ = new ClauseDiffer();
    this.config = {
      nlpBaseUrl: options?.config?.nlpBaseUrl ?? "http://localhost:8000",
      jiraProject: options?.config?.jiraProject ?? "FORGE",
      teamsChannelId: options?.config?.teamsChannelId ?? "contracts-ingestion",
      maxRetries: options?.config?.maxRetries ?? 2,
      retryDelayMs: options?.config?.retryDelayMs ?? 1000,
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload = task.triggerPayload as unknown as S3EventPayload;

    // 1. Log start
    await this.createAuditEntry(task.id, "RUNNING", {
      input: { bucket: payload.bucket, key: payload.key, eventType: payload.eventType },
    });

    // 2. Validate document type
    const documentType = getDocumentType(payload.key);
    if (!documentType) {
      const ext = payload.key.split(".").pop() ?? "unknown";
      await this.createAuditEntry(task.id, "FAILURE", {
        input: { key: payload.key },
        error: `Unsupported file type: ${ext}`,
      });
      return {
        success: false,
        error: `Unsupported file type: ${ext}. Supported types: docx, pdf`,
      };
    }

    // 3. Download document from S3
    await this.mcp.executeTool("s3.getObject", {
      bucket: payload.bucket,
      key: payload.key,
    });

    // 4. Call NLP pipeline with retry
    let ingestionResult: IngestionResponse;
    try {
      ingestionResult = await this.callNlpWithRetry(payload.key, documentType);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.createAuditEntry(task.id, "FAILURE", {
        input: { key: payload.key },
        error: errorMsg,
      });
      return {
        success: false,
        error: `NLP pipeline failed after ${this.config.maxRetries + 1} attempts: ${errorMsg}`,
      };
    }

    const { result, quality } = ingestionResult;
    const { metadata } = result;

    // 5. Determine if this is a new contract or modification
    const isModification = await this.isModificationDocument(payload.key, metadata);
    let contractId: string;
    let modificationId: string | null = null;
    let clauseDiff: ClauseDiff | null = null;
    const downstreamTriggers: AgentTrigger[] = [];

    if (isModification) {
      // 5b. Process as modification
      const parentContractId = await this.findParentContract(metadata.contract_number!);
      contractId = parentContractId;

      // Create modification record
      const modRows = await this.queryDatabase(
        `INSERT INTO contracts.modifications
         (contract_id, mod_number, mod_type, effective_date, description, s3_document_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT')
         RETURNING id`,
        [
          parentContractId,
          this.extractModNumber(payload.key, metadata),
          "SCOPE",
          metadata.pop_start ?? new Date().toISOString().split("T")[0],
          `Modification ingested from ${payload.key}`,
          payload.key,
        ],
      );
      modificationId = (modRows[0] as { id: string })?.id ?? null;

      // Trigger mod FSM
      if (modificationId) {
        await this.transitionState("MODIFICATION", modificationId, "MOD_IDENTIFIED");
      }

      // Compare clauses
      const oldClauses = await this.getExistingClauses(parentContractId);
      const newClauses = this.buildClauseList(metadata);
      clauseDiff = this.differ.compare(oldClauses, newClauses);

      // Trigger downstream if clauses changed
      if (clauseDiff.added.length > 0 || clauseDiff.removed.length > 0 || clauseDiff.modified.length > 0) {
        downstreamTriggers.push({
          agentName: "flowdown-generator",
          payload: { contractId: parentContractId, clauseDiff },
        });
      }
    } else {
      // 5a. Process as new contract
      const contractRows = await this.queryDatabase(
        `INSERT INTO contracts.contracts
         (contract_number, contract_type, awarding_agency, contracting_officer_name,
          contracting_officer_email, pop_start, pop_end, ceiling_value, funded_value,
          naics_code, psc_code, security_level, cage_code, duns_uei,
          s3_document_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'AWARDED')
         RETURNING id`,
        [
          metadata.contract_number ?? `UNKNOWN-${Date.now()}`,
          "FFP", // Default type; could be extracted by NLP in future
          "Unknown Agency",
          metadata.contracting_officer_name ?? "Unknown",
          "unknown@agency.gov",
          metadata.pop_start ?? "2024-01-01",
          metadata.pop_end ?? "2025-12-31",
          metadata.ceiling_value ?? "0.00",
          metadata.funded_value ?? "0.00",
          metadata.naics_code,
          metadata.psc_code,
          metadata.security_level ?? "UNCLASSIFIED",
          metadata.cage_code,
          metadata.uei_number,
          payload.key,
        ],
      );
      contractId = (contractRows[0] as { id: string })?.id ?? result.contract_id;

      // Transition to AWARDED state
      await this.transitionState("PRIME_CONTRACT", contractId, "AWARDED");
    }

    // 6. Store clause records
    const clauseRecords = await this.storeClauseRecords(contractId, metadata);

    // 7. Handle quality report
    let needsReview = false;
    const criticalIssues = quality.issues.filter((i) => i.severity === "ERROR");

    if (criticalIssues.length > 0 || quality.needs_human_review) {
      needsReview = true;
      await this.createQualityJiraTicket(
        metadata,
        quality,
        payload.key,
        contractId,
      );
    }

    // 8. Always trigger clause analysis agent
    downstreamTriggers.push({
      agentName: "clause-analysis",
      payload: {
        contractId,
        s3Key: payload.key,
        isModification,
        clauseDiff,
      },
    });

    // 9. Trigger compliance monitor if POP/options changed
    if (metadata.pop_start || metadata.pop_end) {
      downstreamTriggers.push({
        agentName: "compliance-monitor",
        payload: {
          contractId,
          popStart: metadata.pop_start,
          popEnd: metadata.pop_end,
        },
      });
    }

    // 10. Fire downstream triggers
    for (const trigger of downstreamTriggers) {
      await this.enqueueDownstreamAgent(trigger);
    }

    // 11. Log completion
    await this.createAuditEntry(task.id, "SUCCESS", {
      input: {
        bucket: payload.bucket,
        key: payload.key,
        eventType: payload.eventType,
      },
      output: {
        contractId,
        modificationId,
        isModification,
        chunkCount: result.chunk_count,
        entityCount: result.entity_count,
        clauseCount: clauseRecords,
        qualityIssues: quality.issues.length,
        needsReview,
        downstreamAgents: downstreamTriggers.map((t) => t.agentName),
        durationMs: result.duration_ms,
      },
    });

    return {
      success: true,
      needsReview,
      reviewReason: needsReview
        ? `Quality issues found: ${quality.review_reasons.join(", ")}`
        : undefined,
      data: {
        contractId,
        modificationId,
        isModification,
        chunkCount: result.chunk_count,
        chunksStored: result.chunks_stored,
        entityCount: result.entity_count,
        annotationsStored: result.annotations_stored,
        clauseCount: clauseRecords,
        qualityIssues: quality.issues.length,
        needsReview,
        downstreamAgents: downstreamTriggers.map((t) => t.agentName),
        clauseDiff: clauseDiff
          ? {
              added: clauseDiff.added.length,
              removed: clauseDiff.removed.length,
              modified: clauseDiff.modified.length,
            }
          : null,
        metadata: metadata as unknown as Record<string, unknown>,
      },
    };
  }

  // ─── NLP pipeline with retry ───────────────────────────────────────

  private async callNlpWithRetry(
    s3Key: string,
    documentType: "docx" | "pdf",
  ): Promise<IngestionResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.nlp.ingest(s3Key, documentType);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, this.config.retryDelayMs));
        }
      }
    }

    throw lastError!;
  }

  // ─── Document classification ───────────────────────────────────────

  private async isModificationDocument(
    key: string,
    metadata: ContractMetadata,
  ): Promise<boolean> {
    // Check key path for modification indicators
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("/mod") || lowerKey.includes("modification") || lowerKey.includes("sf30")) {
      return true;
    }

    // If we have a contract number, check if a contract already exists
    if (metadata.contract_number) {
      const existing = await this.queryDatabase(
        "SELECT id FROM contracts.contracts WHERE contract_number = $1",
        [metadata.contract_number],
      );
      return existing.length > 0;
    }

    return false;
  }

  private async findParentContract(contractNumber: string): Promise<string> {
    const rows = await this.queryDatabase(
      "SELECT id FROM contracts.contracts WHERE contract_number = $1",
      [contractNumber],
    );
    if (rows.length === 0) {
      throw new Error(`Parent contract not found: ${contractNumber}`);
    }
    return (rows[0] as { id: string }).id;
  }

  private extractModNumber(key: string, metadata: ContractMetadata): string {
    // Try to extract from the file path
    const modMatch = key.match(/mod[_-]?(\d+)/i);
    if (modMatch) return `P${modMatch[1]!.padStart(5, "0")}`;

    // Default based on timestamp
    return `P${Date.now().toString().slice(-5)}`;
  }

  // ─── Clause operations ─────────────────────────────────────────────

  private async getExistingClauses(contractId: string): Promise<Clause[]> {
    const rows = await this.queryDatabase(
      "SELECT clause_number, clause_title, clause_type FROM contracts.contract_clauses WHERE contract_id = $1",
      [contractId],
    );
    return rows.map((r: any) => ({
      clauseNumber: r.clause_number,
      clauseTitle: r.clause_title,
      clauseType: r.clause_type,
    }));
  }

  private buildClauseList(metadata: ContractMetadata): Clause[] {
    const clauses: Clause[] = [];

    for (const far of metadata.far_clauses) {
      clauses.push({
        clauseNumber: far,
        clauseTitle: far,
        clauseType: "FAR",
      });
    }

    for (const dfars of metadata.dfars_clauses) {
      clauses.push({
        clauseNumber: dfars,
        clauseTitle: dfars,
        clauseType: "DFARS",
      });
    }

    return clauses;
  }

  private async storeClauseRecords(
    contractId: string,
    metadata: ContractMetadata,
  ): Promise<number> {
    const clauses = this.buildClauseList(metadata);
    let stored = 0;

    for (const clause of clauses) {
      await this.queryDatabase(
        `INSERT INTO contracts.contract_clauses
         (contract_id, clause_number, clause_title, clause_type, risk_category)
         VALUES ($1, $2, $3, $4, 'UNASSESSED')
         ON CONFLICT DO NOTHING`,
        [contractId, clause.clauseNumber, clause.clauseTitle, clause.clauseType],
      );
      stored++;
    }

    return stored;
  }

  // ─── Quality issue handling ────────────────────────────────────────

  private async createQualityJiraTicket(
    metadata: ContractMetadata,
    quality: QualityReport,
    s3Key: string,
    contractId: string,
  ): Promise<void> {
    const contractRef = metadata.contract_number ?? s3Key;
    const criticalIssues = quality.issues.filter((i) => i.severity === "ERROR");

    await this.mcp.executeTool("jira.createIssue", {
      project: this.config.jiraProject,
      issueType: "Review",
      summary: `[REVIEW] Ingestion quality issues: ${contractRef}`,
      description: [
        `Contract: ${contractRef}`,
        `Contract ID: ${contractId}`,
        `S3 Key: ${s3Key}`,
        "",
        "Quality Issues:",
        ...quality.issues.map(
          (i) => `- [${i.severity}] ${i.code}: ${i.message}`,
        ),
        "",
        "Review Reasons:",
        ...quality.review_reasons.map((r) => `- ${r}`),
      ].join("\n"),
      fields: {
        priority: { name: criticalIssues.length > 0 ? "HIGH" : "MEDIUM" },
        labels: ["ingestion-review", "quality-issue"],
      },
    });
  }

  // ─── Downstream agent triggers ─────────────────────────────────────

  private async enqueueDownstreamAgent(trigger: AgentTrigger): Promise<void> {
    await this.queryDatabase(
      `INSERT INTO agents.agent_tasks
       (agent_id, trigger_type, trigger_payload, priority, status)
       SELECT id, 'EVENT', $2::jsonb, 'MEDIUM', 'QUEUED'
       FROM agents.agent_registry
       WHERE agent_name = $1`,
      [trigger.agentName, JSON.stringify(trigger.payload)],
    );
  }
}
