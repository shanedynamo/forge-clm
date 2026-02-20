import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "packages/api/src/db/schema.ts",
    "packages/api/src/db/schema-vectors.ts",
    "packages/api/src/db/schema-audit.ts",
    "packages/api/src/db/schema-agents.ts",
  ],
  out: "packages/api/src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5432/forge",
  },
  schemaFilter: ["contracts", "vectors", "audit", "agents"],
});
