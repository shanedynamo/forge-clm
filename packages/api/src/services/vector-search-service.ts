/**
 * Vector search service — semantic search over contract document chunks
 * using pgvector cosine similarity.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, sql, desc } from "drizzle-orm";
import { documentChunks, entityAnnotations } from "../db/schema-vectors.js";
import { contracts } from "../db/schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

// ─── Types ───────────────────────────────────────────────────────────

export interface SearchOptions {
  contractId?: string;
  sectionType?: string;
  clauseType?: string;
  limit?: number;
}

export interface SearchResult {
  chunkId: string;
  chunkText: string;
  similarityScore: number;
  contractId: string;
  contractNumber: string;
  sectionType: string;
  clauseNumber: string | null;
  chunkIndex: number;
  metadata: Record<string, unknown> | null;
}

export interface ClauseMatch {
  chunkId: string;
  chunkText: string;
  similarityScore: number;
  contractId: string;
  contractNumber: string;
  sectionType: string;
  clauseNumber: string | null;
}

export interface RAGContext {
  contractId: string;
  chunks: Array<{
    chunkId: string;
    chunkText: string;
    similarityScore: number;
    sectionType: string;
    clauseNumber: string | null;
    chunkIndex: number;
  }>;
  totalTokensEstimate: number;
}

// ─── Embedding client interface ──────────────────────────────────────

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
}

/**
 * Default embedding client — calls the NLP microservice /embed endpoint.
 */
export class NlpEmbeddingClient implements EmbeddingClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ?? process.env["NLP_SERVICE_URL"] ?? "http://localhost:8000";
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text] }),
    });

    if (!response.ok) {
      throw new Error(`NLP embed failed: ${response.status}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings[0]!;
  }
}

// ─── Service ─────────────────────────────────────────────────────────

export class VectorSearchService {
  constructor(
    private readonly db: AnyDb,
    private readonly embeddingClient: EmbeddingClient,
  ) {}

  /**
   * Semantic search across all document chunks.
   */
  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;
    const embedding = await this.embeddingClient.embed(query);
    const vecStr = `[${embedding.join(",")}]`;

    // Build WHERE conditions (values are safe: UUIDs and enum strings)
    const conditions: string[] = [];

    if (options.contractId) {
      // UUID format validated by caller
      const escaped = options.contractId.replace(/'/g, "''");
      conditions.push(`dc.contract_id = '${escaped}'::uuid`);
    }

    if (options.sectionType) {
      const escaped = options.sectionType.replace(/'/g, "''");
      conditions.push(`dc.section_type = '${escaped}'`);
    }

    if (options.clauseType) {
      const escaped = options.clauseType.replace(/'/g, "''");
      conditions.push(`dc.clause_number LIKE '${escaped}%'`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Use cosine distance: 1 - (distance) = similarity
    const queryText = `
      SELECT
        dc.id AS "chunkId",
        dc.chunk_text AS "chunkText",
        1 - (dc.embedding <=> '${vecStr}'::vector) AS "similarityScore",
        dc.contract_id AS "contractId",
        c.contract_number AS "contractNumber",
        dc.section_type AS "sectionType",
        dc.clause_number AS "clauseNumber",
        dc.chunk_index AS "chunkIndex",
        dc.metadata_json AS "metadata"
      FROM vectors.document_chunks dc
      JOIN contracts.contracts c ON c.id = dc.contract_id
      ${whereClause}
      ORDER BY dc.embedding <=> '${vecStr}'::vector ASC
      LIMIT ${limit}
    `;

    const results = await (this.db as any).execute(
      sql.raw(queryText),
    );

    return (results.rows ?? results) as SearchResult[];
  }

  /**
   * Find clauses similar to a given clause text.
   */
  async searchSimilarClauses(
    clauseText: string,
    limit: number = 5,
  ): Promise<ClauseMatch[]> {
    const embedding = await this.embeddingClient.embed(clauseText);
    const vecStr = `[${embedding.join(",")}]`;

    const queryText = `
      SELECT
        dc.id AS "chunkId",
        dc.chunk_text AS "chunkText",
        1 - (dc.embedding <=> '${vecStr}'::vector) AS "similarityScore",
        dc.contract_id AS "contractId",
        c.contract_number AS "contractNumber",
        dc.section_type AS "sectionType",
        dc.clause_number AS "clauseNumber"
      FROM vectors.document_chunks dc
      JOIN contracts.contracts c ON c.id = dc.contract_id
      WHERE dc.section_type = 'SECTION_I'
      ORDER BY dc.embedding <=> '${vecStr}'::vector ASC
      LIMIT ${limit}
    `;

    const results = await (this.db as any).execute(sql.raw(queryText));
    return (results.rows ?? results) as ClauseMatch[];
  }

  /**
   * Retrieve relevant context chunks from a specific contract for RAG.
   * Returns both vector-matched chunks and structurally adjacent chunks.
   */
  async getContractContext(
    contractId: string,
    query: string,
    maxChunks: number = 8,
  ): Promise<RAGContext> {
    const embedding = await this.embeddingClient.embed(query);
    const vecStr = `[${embedding.join(",")}]`;

    // Get top chunks by similarity within this contract
    const queryText = `
      SELECT
        dc.id AS "chunkId",
        dc.chunk_text AS "chunkText",
        1 - (dc.embedding <=> '${vecStr}'::vector) AS "similarityScore",
        dc.section_type AS "sectionType",
        dc.clause_number AS "clauseNumber",
        dc.chunk_index AS "chunkIndex"
      FROM vectors.document_chunks dc
      WHERE dc.contract_id = '${contractId}'::uuid
      ORDER BY dc.embedding <=> '${vecStr}'::vector ASC
      LIMIT ${Math.ceil(maxChunks / 2)}
    `;

    const vectorMatched = await (this.db as any).execute(sql.raw(queryText));
    const matchedRows = (vectorMatched.rows ?? vectorMatched) as Array<{
      chunkId: string;
      chunkText: string;
      similarityScore: number;
      sectionType: string;
      clauseNumber: string | null;
      chunkIndex: number;
    }>;

    // Get adjacent chunks for context continuity
    const matchedIndices = matchedRows.map((r) => r.chunkIndex);
    const adjacentIndices = new Set<number>();
    for (const idx of matchedIndices) {
      adjacentIndices.add(idx - 1);
      adjacentIndices.add(idx + 1);
    }
    // Remove indices we already have
    for (const idx of matchedIndices) {
      adjacentIndices.delete(idx);
    }

    let adjacentRows: typeof matchedRows = [];
    if (adjacentIndices.size > 0) {
      const idxList = [...adjacentIndices].filter((i) => i >= 0).join(",");
      if (idxList) {
        const adjQuery = `
          SELECT
            dc.id AS "chunkId",
            dc.chunk_text AS "chunkText",
            0.0 AS "similarityScore",
            dc.section_type AS "sectionType",
            dc.clause_number AS "clauseNumber",
            dc.chunk_index AS "chunkIndex"
          FROM vectors.document_chunks dc
          WHERE dc.contract_id = '${contractId}'::uuid
            AND dc.chunk_index IN (${idxList})
        `;
        const adjResult = await (this.db as any).execute(sql.raw(adjQuery));
        adjacentRows = (adjResult.rows ?? adjResult) as typeof matchedRows;
      }
    }

    // Merge, deduplicate, sort by chunk_index, limit
    const allChunksMap = new Map<string, (typeof matchedRows)[0]>();
    for (const row of [...matchedRows, ...adjacentRows]) {
      if (!allChunksMap.has(row.chunkId)) {
        allChunksMap.set(row.chunkId, row);
      }
    }

    const allChunks = [...allChunksMap.values()]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, maxChunks);

    const totalTokensEstimate = allChunks.reduce(
      (sum, c) => sum + Math.ceil(c.chunkText.length / 4),
      0,
    );

    return {
      contractId,
      chunks: allChunks,
      totalTokensEstimate,
    };
  }
}
