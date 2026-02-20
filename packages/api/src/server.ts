import Fastify from "fastify";
import cors from "@fastify/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { FsmService } from "./services/fsm-service.js";
import { errorHandlerPlugin } from "./lib/errors.js";
import { authPlugin } from "./middleware/auth.js";
import contractRoutes from "./routes/contracts.js";
import modificationRoutes from "./routes/modifications.js";
import requestRoutes from "./routes/requests.js";
import ndaRoutes from "./routes/ndas.js";
import mouRoutes from "./routes/mous.js";
import searchRoutes from "./routes/search.js";
import complianceRoutes from "./routes/compliance.js";

const envToLogger: Record<string, boolean> = {
  development: true,
  production: true,
  test: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

export interface BuildAppOverrides {
  embeddingClient?: unknown;
  llmProvider?: unknown;
}

export async function buildApp(dbOverride?: AnyDb, overrides?: BuildAppOverrides) {
  // Database setup
  let db: AnyDb;
  let client: ReturnType<typeof postgres> | undefined;

  if (dbOverride) {
    db = dbOverride;
  } else {
    const connectionString = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5432/forge";
    client = postgres(connectionString);
    db = drizzle(client);
  }

  const fsmService = new FsmService(db);

  const app = Fastify({
    logger: envToLogger[process.env["NODE_ENV"] ?? "development"] ?? true,
  });

  await app.register(cors, {
    origin: ["http://localhost:5173"],
    credentials: true,
  });

  // Health check — registered BEFORE auth plugin (unauthenticated)
  app.get("/health", async () => {
    return { status: "ok", service: "forge-api", timestamp: new Date().toISOString() };
  });

  // Error handler & auth
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  // API routes under /api/v1 prefix
  const routeOpts = { db, fsmService, ...overrides };

  await app.register(async (api) => {
    await api.register(contractRoutes, routeOpts);
    await api.register(modificationRoutes, routeOpts);
    await api.register(requestRoutes, routeOpts);
    await api.register(ndaRoutes, routeOpts);
    await api.register(mouRoutes, routeOpts);
    await api.register(searchRoutes, routeOpts);
    await api.register(complianceRoutes, routeOpts);
  }, { prefix: "/api/v1" });

  // Graceful shutdown
  const shutdown = async () => {
    await app.close();
    if (client) await client.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return app;
}

async function start() {
  const app = await buildApp();
  const port = Number(process.env["PORT"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only start when run directly (not when imported in tests)
const isMainModule =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  start();
}
