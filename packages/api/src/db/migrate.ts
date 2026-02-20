import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5432/forge";

async function runMigrations() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.url).pathname });
  console.log("Migrations complete.");

  await client.end();
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
