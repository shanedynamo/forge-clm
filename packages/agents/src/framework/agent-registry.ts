/**
 * Agent registry — manages agent registration and syncs with the
 * agents.agent_registry database table.
 */

import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { BaseAgent } from "./base-agent.js";

// Re-export the drizzle table definition path for use in this package
// The actual table is in @forge/api — we import the schema shape only
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// Mirror the agents.agent_registry table definition (avoiding cross-package import)
const agentsSchema = pgSchema("agents");

export const agentRegistryTable = agentsSchema.table("agent_registry", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentName: varchar("agent_name", { length: 255 }).notNull().unique(),
  agentType: varchar("agent_type", { length: 100 }).notNull(),
  description: text("description"),
  mcpToolIds: text("mcp_tool_ids").array(),
  enabled: boolean("enabled").notNull().default(true),
  configJson: jsonb("config_json").notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  lastDeployedAt: timestamp("last_deployed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;

export class AgentRegistry {
  private agents = new Map<string, BaseAgent>();

  constructor(private readonly db?: AnyDb) {}

  /**
   * Register an agent instance in-memory and optionally sync to database.
   */
  async register(agent: BaseAgent): Promise<void> {
    this.agents.set(agent.name, agent);

    if (this.db) {
      // Upsert into agents.agent_registry
      const existing = await this.db
        .select({ id: agentRegistryTable.id })
        .from(agentRegistryTable)
        .where(eq(agentRegistryTable.agentName, agent.name));

      if (existing.length > 0) {
        await this.db
          .update(agentRegistryTable)
          .set({
            agentType: agent.type,
            description: agent.description,
            enabled: true,
            updatedAt: new Date(),
          })
          .where(eq(agentRegistryTable.agentName, agent.name));
      } else {
        await this.db.insert(agentRegistryTable).values({
          agentName: agent.name,
          agentType: agent.type,
          description: agent.description,
          enabled: true,
          configJson: {},
          version: "1.0.0",
        });
      }
    }
  }

  /**
   * Get an agent by name.
   */
  get(agentName: string): BaseAgent {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found in registry`);
    }
    return agent;
  }

  /**
   * List all agents that are enabled (both in-memory and in DB).
   */
  async listEnabled(): Promise<BaseAgent[]> {
    if (!this.db) {
      return [...this.agents.values()];
    }

    const enabledRows = await this.db
      .select({ agentName: agentRegistryTable.agentName })
      .from(agentRegistryTable)
      .where(eq(agentRegistryTable.enabled, true));

    const enabledNames = new Set(enabledRows.map((r) => r.agentName));

    return [...this.agents.values()].filter((a) => enabledNames.has(a.name));
  }

  /**
   * Check if an agent is registered.
   */
  has(agentName: string): boolean {
    return this.agents.has(agentName);
  }
}
