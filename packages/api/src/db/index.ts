import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import * as schemaVectors from "./schema-vectors.js";
import * as schemaAudit from "./schema-audit.js";
import * as schemaAgents from "./schema-agents.js";
import * as relations from "./relations.js";
import * as relationsVectors from "./relations-vectors.js";
import * as relationsAudit from "./relations-audit.js";
import * as relationsAgents from "./relations-agents.js";

const connectionString = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5432/forge";

const client = postgres(connectionString);
export const db = drizzle(client, {
  schema: {
    ...schema,
    ...schemaVectors,
    ...schemaAudit,
    ...schemaAgents,
    ...relations,
    ...relationsVectors,
    ...relationsAudit,
    ...relationsAgents,
  },
});
