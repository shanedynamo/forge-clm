import { relations } from "drizzle-orm";
import { contracts, clauseLibrary } from "./schema.js";
import { documentChunks, entityAnnotations, clauseEmbeddings } from "./schema-vectors.js";

export const documentChunksRelations = relations(documentChunks, ({ one, many }) => ({
  contract: one(contracts, {
    fields: [documentChunks.contractId],
    references: [contracts.id],
  }),
  entityAnnotations: many(entityAnnotations),
}));

export const entityAnnotationsRelations = relations(entityAnnotations, ({ one }) => ({
  chunk: one(documentChunks, {
    fields: [entityAnnotations.chunkId],
    references: [documentChunks.id],
  }),
}));

export const clauseEmbeddingsRelations = relations(clauseEmbeddings, ({ one }) => ({
  clauseLibrary: one(clauseLibrary, {
    fields: [clauseEmbeddings.clauseLibraryId],
    references: [clauseLibrary.id],
  }),
}));
