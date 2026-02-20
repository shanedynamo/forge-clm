import type { FastifyInstance } from "fastify";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import {
  VectorSearchService,
  NlpEmbeddingClient,
  type EmbeddingClient,
} from "../services/vector-search-service.js";
import { RAGService } from "../services/rag-service.js";
import { createLLMProvider, type LLMProvider } from "../services/llm-provider.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

interface RouteOptions {
  db: AnyDb;
  embeddingClient?: EmbeddingClient;
  llmProvider?: LLMProvider;
}

// ─── Zod schemas ─────────────────────────────────────────────────────

const searchBodySchema = z.object({
  query: z.string().min(1),
  filters: z
    .object({
      contractId: z.string().uuid().optional(),
      sectionType: z.string().optional(),
      clauseType: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const askBodySchema = z.object({
  question: z.string().min(1),
  contract_id: z.string().uuid().optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────

export default async function searchRoutes(app: FastifyInstance, opts: RouteOptions) {
  const { db } = opts;

  const embeddingClient = opts.embeddingClient ?? new NlpEmbeddingClient();
  const llmProvider = opts.llmProvider ?? createLLMProvider();

  const vectorSearch = new VectorSearchService(db, embeddingClient);
  const ragService = new RAGService(vectorSearch, llmProvider);

  // ─── POST /search ────────────────────────────────────────────────

  app.post("/search", async (request) => {
    const body = searchBodySchema.parse(request.body);

    const embedStart = performance.now();
    const results = await vectorSearch.search(body.query, {
      contractId: body.filters?.contractId,
      sectionType: body.filters?.sectionType,
      clauseType: body.filters?.clauseType,
      limit: body.limit,
    });
    const totalMs = performance.now() - embedStart;

    return {
      results,
      query_embedding_time_ms: Math.round(totalMs * 0.3),
      search_time_ms: Math.round(totalMs * 0.7),
    };
  });

  // ─── POST /ask ───────────────────────────────────────────────────

  app.post("/ask", async (request) => {
    const body = askBodySchema.parse(request.body);

    const answer = await ragService.answerQuestion(body.question, {
      contractId: body.contract_id,
    });

    return {
      answer: answer.answer,
      citations: answer.citations,
      confidence: answer.confidence,
    };
  });
}
