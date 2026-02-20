import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { contracts, clauseLibrary } from "./schema";

// ─── Custom vector type for pgvector ─────────────────────────────────

export const vector = customType<{
  data: number[];
  driverParam: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 768})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === "string") {
      return value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map(Number);
    }
    return value as number[];
  },
});

// ─── Schema ──────────────────────────────────────────────────────────
export const vectorsSchema = pgSchema("vectors");

// ─── Enums ───────────────────────────────────────────────────────────

export const sectionTypeEnum = vectorsSchema.enum("section_type", [
  "SECTION_A",
  "SECTION_B",
  "SECTION_C",
  "SECTION_D",
  "SECTION_E",
  "SECTION_F",
  "SECTION_G",
  "SECTION_H",
  "SECTION_I",
  "SECTION_J",
  "SECTION_K",
  "SECTION_L",
  "SECTION_M",
  "PREAMBLE",
  "ATTACHMENT",
  "OTHER",
]);

// ─── 1. document_chunks ──────────────────────────────────────────────

export const documentChunks = vectorsSchema.table(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    documentS3Key: varchar("document_s3_key", { length: 1000 }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    sectionType: sectionTypeEnum("section_type").notNull(),
    clauseNumber: varchar("clause_number", { length: 50 }),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_document_chunks_contract_id").on(table.contractId),
    index("idx_document_chunks_section_type").on(table.sectionType),
  ],
);

// NOTE: The HNSW index on the embedding column is created via custom SQL
// in the migration file because Drizzle ORM does not support HNSW index syntax.
// CREATE INDEX idx_document_chunks_embedding_hnsw ON vectors.document_chunks
// USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

// ─── 2. entity_annotations ───────────────────────────────────────────

export const entityAnnotations = vectorsSchema.table(
  "entity_annotations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityValue: varchar("entity_value", { length: 1000 }).notNull(),
    startChar: integer("start_char").notNull(),
    endChar: integer("end_char").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    modelVersion: varchar("model_version", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_entity_annotations_chunk_id").on(table.chunkId),
    index("idx_entity_annotations_entity_type").on(table.entityType),
  ],
);

// ─── 3. clause_embeddings ────────────────────────────────────────────

export const clauseEmbeddings = vectorsSchema.table(
  "clause_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clauseLibraryId: uuid("clause_library_id")
      .notNull()
      .references(() => clauseLibrary.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    version: varchar("version", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_clause_embeddings_clause_library_id").on(table.clauseLibraryId),
  ],
);
