/**
 * RAG (Retrieval-Augmented Generation) service — answers natural language
 * questions about contracts using vector search + LLM.
 */

import type { VectorSearchService, SearchOptions, RAGContext } from "./vector-search-service.js";
import type { LLMProvider } from "./llm-provider.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface RAGOptions {
  contractId?: string;
  maxChunks?: number;
  includeSourceText?: boolean;
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

export interface RAGAnswer {
  answer: string;
  citations: Citation[];
  confidence: number;
  contextTokensUsed: number;
}

export interface ClauseAnalysis {
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  deviations: string[];
  justification: string;
  recommendations: string[];
  similarClauses: Array<{
    contractNumber: string;
    clauseNumber: string | null;
    similarityScore: number;
  }>;
}

export interface ContractSummary {
  summary: string;
  keyTerms: string[];
  risks: string[];
  obligations: string[];
}

// ─── Service ─────────────────────────────────────────────────────────

export class RAGService {
  constructor(
    private readonly vectorSearch: VectorSearchService,
    private readonly llm: LLMProvider,
  ) {}

  /**
   * Answer a natural-language question using RAG.
   */
  async answerQuestion(
    question: string,
    options: RAGOptions = {},
  ): Promise<RAGAnswer> {
    // 1. Retrieve relevant chunks
    let context: RAGContext | null = null;
    let citations: Citation[] = [];

    if (options.contractId) {
      // Scoped to a specific contract
      context = await this.vectorSearch.getContractContext(
        options.contractId,
        question,
        options.maxChunks ?? 8,
      );

      // For citations, we need contract numbers — run a search to get them
      const searchResults = await this.vectorSearch.search(question, {
        contractId: options.contractId,
        limit: options.maxChunks ?? 8,
      });

      citations = searchResults.map((r) => ({
        chunkId: r.chunkId,
        chunkText: r.chunkText,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        sectionType: r.sectionType,
        clauseNumber: r.clauseNumber,
        similarityScore: r.similarityScore,
      }));
    } else {
      // Search across all contracts
      const searchResults = await this.vectorSearch.search(question, {
        limit: options.maxChunks ?? 8,
      });

      citations = searchResults.map((r) => ({
        chunkId: r.chunkId,
        chunkText: r.chunkText,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        sectionType: r.sectionType,
        clauseNumber: r.clauseNumber,
        similarityScore: r.similarityScore,
      }));
    }

    // 2. Build prompt with context
    const contextText = citations
      .map(
        (c, i) =>
          `[Source ${i + 1}] Contract: ${c.contractNumber}, Section: ${c.sectionType}${c.clauseNumber ? `, Clause: ${c.clauseNumber}` : ""}\n${c.chunkText}`,
      )
      .join("\n\n---\n\n");

    const contextTokensUsed = Math.ceil(contextText.length / 4);

    const prompt = `You are a federal contract analyst assistant. Answer the user's question based ONLY on the provided contract context. If the context does not contain enough information, say so.

TASK: ANSWER_QUESTION

Context:
${contextText}

Question: ${question}

Respond with a JSON object: { "answer": string, "confidence": number (0-1) }`;

    // 3. Call LLM
    const rawResponse = await this.llm.complete(prompt, {
      maxTokens: 1024,
      temperature: 0.2,
    });

    // 4. Parse response
    let parsed: { answer: string; confidence: number };
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      parsed = { answer: rawResponse, confidence: 0.3 };
    }

    return {
      answer: parsed.answer,
      citations,
      confidence: parsed.confidence,
      contextTokensUsed,
    };
  }

  /**
   * Analyze a clause against similar clauses and playbook rules.
   */
  async analyzeClause(
    clauseText: string,
    contractId: string,
  ): Promise<ClauseAnalysis> {
    // 1. Find similar clauses across the corpus
    const similarClauses = await this.vectorSearch.searchSimilarClauses(
      clauseText,
      5,
    );

    // 2. Build comparison prompt
    const comparisons = similarClauses
      .map(
        (c, i) =>
          `[Comparison ${i + 1}] Contract: ${c.contractNumber}, Score: ${c.similarityScore.toFixed(3)}\n${c.chunkText}`,
      )
      .join("\n\n---\n\n");

    const prompt = `You are a federal contract clause analyst. Compare the given clause against similar clauses from the corpus and identify deviations from standard positions.

TASK: ANALYZE_CLAUSE

Clause under analysis:
${clauseText}

Similar clauses from corpus:
${comparisons}

Respond with a JSON object: { "risk_level": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "deviations": string[], "justification": string, "recommendations": string[] }`;

    const rawResponse = await this.llm.complete(prompt, {
      maxTokens: 1024,
      temperature: 0.1,
    });

    let parsed: {
      risk_level: string;
      deviations: string[];
      justification: string;
      recommendations: string[];
    };
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      parsed = {
        risk_level: "MEDIUM",
        deviations: ["Unable to parse analysis"],
        justification: rawResponse,
        recommendations: [],
      };
    }

    return {
      riskLevel: parsed.risk_level as ClauseAnalysis["riskLevel"],
      deviations: parsed.deviations,
      justification: parsed.justification,
      recommendations: parsed.recommendations,
      similarClauses: similarClauses.map((c) => ({
        contractNumber: c.contractNumber,
        clauseNumber: c.clauseNumber,
        similarityScore: c.similarityScore,
      })),
    };
  }

  /**
   * Generate a plain-language summary of a contract.
   */
  async summarizeContract(contractId: string): Promise<ContractSummary> {
    // Get a broad context from the contract — use a generic query
    const context = await this.vectorSearch.getContractContext(
      contractId,
      "contract scope terms obligations deliverables period of performance value",
      12,
    );

    const contextText = context.chunks
      .map(
        (c, i) =>
          `[Section ${i + 1}] ${c.sectionType}${c.clauseNumber ? ` (${c.clauseNumber})` : ""}\n${c.chunkText}`,
      )
      .join("\n\n---\n\n");

    const prompt = `You are a federal contract analyst. Summarize the following contract in plain language.

TASK: SUMMARIZE_CONTRACT

Contract context:
${contextText}

Respond with a JSON object: { "summary": string, "key_terms": string[], "risks": string[], "obligations": string[] }`;

    const rawResponse = await this.llm.complete(prompt, {
      maxTokens: 2048,
      temperature: 0.3,
    });

    let parsed: {
      summary: string;
      key_terms: string[];
      risks: string[];
      obligations: string[];
    };
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      parsed = {
        summary: rawResponse,
        key_terms: [],
        risks: [],
        obligations: [],
      };
    }

    return {
      summary: parsed.summary,
      keyTerms: parsed.key_terms,
      risks: parsed.risks,
      obligations: parsed.obligations,
    };
  }
}
