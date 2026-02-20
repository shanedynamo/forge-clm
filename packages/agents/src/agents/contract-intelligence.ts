/**
 * Contract Intelligence Agent — RAG-powered Q&A interface.
 *
 * Answers natural-language questions about contracts by combining
 * pgvector semantic search with structured Postgres data and LLM
 * generation, with anti-hallucination guardrails.
 */

import {
  BaseAgent,
  type AgentTask,
  type AgentResult,
  type AgentDependencies,
  type SearchResult,
} from "../framework/base-agent.js";
import { buildRAGPrompt } from "./prompts/contract-intelligence.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ContractIntelligencePayload {
  question: string;
  contractId?: string;
  userId?: string;
  source?: "dashboard" | "teams" | "api";
}

export interface Citation {
  chunkId: string;
  chunkText: string;
  contractId: string;
  contractNumber: string;
  sectionType: string;
  clauseNumber: string | null;
  similarityScore: number;
}

export interface IntelligenceAnswer {
  answer: string;
  citations: Citation[];
  confidence: number;
  contractId?: string;
  flaggedForReview: boolean;
  reviewReason?: string;
}

export interface ContractIntelligenceConfig {
  minSimilarityThreshold?: number;
  maxChunks?: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_MIN_SIMILARITY = 0.5;
const DEFAULT_MAX_CHUNKS = 10;

// ─── Helpers ─────────────────────────────────────────────────────────

export function parseIntelligenceResponse(raw: string): {
  answer: string;
  cited_sources: number[];
  confidence: number;
} {
  try {
    const parsed = JSON.parse(raw);
    return {
      answer: typeof parsed.answer === "string" ? parsed.answer : raw,
      cited_sources: Array.isArray(parsed.cited_sources) ? parsed.cited_sources : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return { answer: raw, cited_sources: [], confidence: 0.3 };
  }
}

export function computeConfidence(
  chunks: Array<{ similarityScore: number }>,
  citedIndices: number[],
): number {
  if (chunks.length === 0) return 0;

  // Use the cited chunks' scores if available, else all chunks
  const scores =
    citedIndices.length > 0
      ? citedIndices
          .filter((i) => i >= 1 && i <= chunks.length)
          .map((i) => chunks[i - 1]!.similarityScore)
      : chunks.map((c) => c.similarityScore);

  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

// ─── Agent ───────────────────────────────────────────────────────────

export class ContractIntelligenceAgent extends BaseAgent {
  readonly name = "contract-intelligence";
  readonly type = "contract_intelligence";
  readonly description =
    "Answers natural-language questions about contracts using RAG";

  private readonly config: Required<ContractIntelligenceConfig>;

  constructor(
    deps: AgentDependencies,
    options?: { config?: ContractIntelligenceConfig },
  ) {
    super(deps);
    this.config = {
      minSimilarityThreshold:
        options?.config?.minSimilarityThreshold ?? DEFAULT_MIN_SIMILARITY,
      maxChunks: options?.config?.maxChunks ?? DEFAULT_MAX_CHUNKS,
    };
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const payload =
      task.triggerPayload as unknown as ContractIntelligencePayload;
    const { question, contractId } = payload;

    await this.createAuditEntry(task.id, "RUNNING", {
      input: { question, contractId, source: payload.source },
    });

    // 1. Search vectors — scoped by contract if provided
    const searchOpts = contractId
      ? { contractId, limit: this.config.maxChunks }
      : { limit: this.config.maxChunks };

    const chunks = await this.searchVectors(question, searchOpts);

    // 2. Anti-hallucination: check similarity threshold
    const qualifyingChunks = chunks.filter(
      (c) => c.similarityScore >= this.config.minSimilarityThreshold,
    );

    if (qualifyingChunks.length === 0) {
      const noInfoAnswer: IntelligenceAnswer = {
        answer:
          "I don't have enough information in the available contract documents to answer this question.",
        citations: [],
        confidence: 0,
        contractId,
        flaggedForReview: false,
      };

      await this.createAuditEntry(task.id, "SUCCESS", {
        input: { question, contractId },
        output: { answer: noInfoAnswer.answer, confidence: 0, citationCount: 0 },
      });

      return { success: true, data: noInfoAnswer as unknown as Record<string, unknown> };
    }

    // 3. Query structured data for the relevant contracts
    const contractIds = [
      ...new Set(qualifyingChunks.map((c) => c.contractId)),
    ];
    const structuredData = await this.loadStructuredData(contractIds);

    // 4. Build citations from qualifying chunks
    const citations: Citation[] = await this.buildCitations(qualifyingChunks);

    // 5. Build RAG prompt
    const contextChunks = citations.map((c, i) => ({
      sourceLabel: `Contract: ${c.contractNumber}, Section: ${c.sectionType}${c.clauseNumber ? `, Clause: ${c.clauseNumber}` : ""}`,
      text: c.chunkText,
    }));

    const prompt = buildRAGPrompt({
      question,
      contextChunks,
      structuredData: structuredData || undefined,
    });

    // 6. Call LLM
    const rawResponse = await this.callLLM(prompt, {
      maxTokens: 1024,
      temperature: 0.2,
    });

    // 7. Parse response
    const parsed = parseIntelligenceResponse(rawResponse);

    // 8. Compute confidence based on cited chunk similarity scores
    const confidence = computeConfidence(citations, parsed.cited_sources);

    // 9. Filter citations to only those actually cited
    const citedCitations =
      parsed.cited_sources.length > 0
        ? parsed.cited_sources
            .filter((i) => i >= 1 && i <= citations.length)
            .map((i) => citations[i - 1]!)
        : citations;

    // 10. Anti-hallucination: check for entity references not in context
    const { flagged, reason } = this.checkForHallucination(
      parsed.answer,
      qualifyingChunks,
      structuredData,
    );

    const result: IntelligenceAnswer = {
      answer: parsed.answer,
      citations: citedCitations,
      confidence,
      contractId,
      flaggedForReview: flagged,
      reviewReason: reason,
    };

    // 11. Log to audit
    await this.createAuditEntry(task.id, "SUCCESS", {
      input: { question, contractId, source: payload.source },
      output: {
        answer: parsed.answer,
        confidence,
        citationCount: citedCitations.length,
        flaggedForReview: flagged,
      },
    });

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      needsReview: flagged,
      reviewReason: reason,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async buildCitations(chunks: SearchResult[]): Promise<Citation[]> {
    // Resolve contract numbers for each unique contractId
    const contractNumberMap = new Map<string, string>();

    for (const chunk of chunks) {
      if (!contractNumberMap.has(chunk.contractId)) {
        try {
          const ctx = await this.getContractContext(chunk.contractId);
          contractNumberMap.set(chunk.contractId, ctx.contractNumber);
        } catch {
          contractNumberMap.set(chunk.contractId, "UNKNOWN");
        }
      }
    }

    return chunks.map((c) => ({
      chunkId: c.chunkId,
      chunkText: c.chunkText,
      contractId: c.contractId,
      contractNumber: contractNumberMap.get(c.contractId) ?? "UNKNOWN",
      sectionType: c.sectionType,
      clauseNumber: c.clauseNumber,
      similarityScore: c.similarityScore,
    }));
  }

  private async loadStructuredData(
    contractIds: string[],
  ): Promise<string | null> {
    if (contractIds.length === 0) return null;

    const parts: string[] = [];

    for (const cid of contractIds) {
      try {
        const ctx = await this.getContractContext(cid);
        parts.push(
          [
            `Contract: ${ctx.contractNumber}`,
            `  Status: ${ctx.status}`,
            `  Type: ${ctx.contractType}`,
            `  Agency: ${ctx.awardingAgency}`,
            `  Ceiling: $${ctx.ceilingValue}`,
            `  Funded: $${ctx.fundedValue}`,
            `  PoP: ${ctx.popStart} to ${ctx.popEnd}`,
          ].join("\n"),
        );
      } catch {
        // Contract context unavailable — skip
      }
    }

    // Also query options for the contracts
    for (const cid of contractIds) {
      const options = await this.queryDatabase(
        `SELECT option_number, option_start, option_end, exercise_deadline, status
         FROM contracts.contract_options
         WHERE contract_id = $1
         ORDER BY option_number`,
        [cid],
      );

      if (options.length > 0) {
        const optLines = (options as any[]).map(
          (o) =>
            `  Option ${o.option_number}: ${o.option_start} - ${o.option_end} (Deadline: ${o.exercise_deadline}, Status: ${o.status})`,
        );
        parts.push(`Options:\n${optLines.join("\n")}`);
      }
    }

    return parts.length > 0 ? parts.join("\n\n") : null;
  }

  private checkForHallucination(
    answer: string,
    chunks: SearchResult[],
    structuredData: string | null,
  ): { flagged: boolean; reason?: string } {
    // Build a set of contract numbers referenced in context
    const contextText = [
      ...chunks.map((c) => c.chunkText),
      structuredData ?? "",
    ].join(" ");

    // Check if the answer references specific contract numbers not in context
    const contractNumberPattern = /\b[A-Z][A-Z0-9]{4,5}-\d{2}-[A-Z]-\d{4}\b/g;
    const answerContractRefs = answer.match(contractNumberPattern) ?? [];
    const contextContractRefs = contextText.match(contractNumberPattern) ?? [];
    const contextRefSet = new Set(contextContractRefs);

    const unknownRefs = answerContractRefs.filter(
      (ref) => !contextRefSet.has(ref),
    );

    if (unknownRefs.length > 0) {
      return {
        flagged: true,
        reason: `Answer references contract numbers not in context: ${unknownRefs.join(", ")}`,
      };
    }

    return { flagged: false };
  }
}
