import { eq, sql, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  FsmEngine,
  FsmError,
  PRIME_CONTRACT_FSM,
  MODIFICATION_FSM,
  NDA_FSM,
  MOU_FSM,
} from "@forge/shared";
import type {
  EntityType,
  FsmRole,
  FsmAuditLogger,
  FsmConfig,
  PrimeContractState,
  ModificationState,
  NdaState,
  MouState,
} from "@forge/shared";
import { contracts, modifications, ndas, mous } from "../db/schema.js";
import { auditLog } from "../db/schema-audit.js";

// ─── Transition history entry ────────────────────────────────────────

export interface TransitionHistoryEntry {
  id: number;
  timestamp: Date;
  fromState: string;
  toState: string;
  userId: string;
  role: string;
  success: boolean;
  errorMessage: string | null;
}

// ─── FSM Service ─────────────────────────────────────────────────────

export class FsmService {
  private engines: Map<EntityType, FsmEngine<string>>;

  constructor(private readonly db: PostgresJsDatabase) {
    this.engines = new Map();

    // Initialize engines with audit loggers
    const configs: FsmConfig<string>[] = [
      PRIME_CONTRACT_FSM,
      MODIFICATION_FSM,
      NDA_FSM,
      MOU_FSM,
    ];

    for (const config of configs) {
      const engine = new FsmEngine(config);
      engine.setAuditLogger(this.createAuditLogger());
      this.engines.set(config.entityType, engine);
    }
  }

  // ─── Transition ─────────────────────────────────────────────────────

  async transition(
    entityType: EntityType,
    entityId: string,
    toState: string,
    userId: string,
    role: FsmRole,
  ): Promise<string> {
    const engine = this.getEngine(entityType);
    const currentState = await this.getCurrentState(entityType, entityId);
    const newState = await engine.transition(currentState, toState, userId, role, entityId);

    // Persist the new state
    await this.persistState(entityType, entityId, newState);

    return newState;
  }

  // ─── Available transitions ──────────────────────────────────────────

  async getAvailableTransitions(
    entityType: EntityType,
    entityId: string,
    role: FsmRole,
  ): Promise<Array<{ to: string; requiredRole: FsmRole }>> {
    const engine = this.getEngine(entityType);
    const currentState = await this.getCurrentState(entityType, entityId);
    return engine.getAvailableTransitions(currentState, role).map((t) => ({
      to: t.to,
      requiredRole: t.requiredRole,
    }));
  }

  // ─── History ────────────────────────────────────────────────────────

  async getHistory(
    entityType: EntityType,
    entityId: string,
  ): Promise<TransitionHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(
        sql`${auditLog.tableName} = 'fsm_transition'
            AND ${auditLog.schemaName} = ${entityType}
            AND ${auditLog.recordId} = ${entityId}`,
      )
      .orderBy(auditLog.id);

    return rows.map((row) => {
      const newValues = row.newValues as Record<string, unknown> | null;
      return {
        id: row.id,
        timestamp: row.timestamp,
        fromState: (newValues?.["from_state"] as string) ?? "",
        toState: (newValues?.["to_state"] as string) ?? "",
        userId: row.changedBy,
        role: (newValues?.["role"] as string) ?? "",
        success: (newValues?.["success"] as boolean) ?? false,
        errorMessage: (newValues?.["error_message"] as string) ?? null,
      };
    });
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  private getEngine(entityType: EntityType): FsmEngine<string> {
    const engine = this.engines.get(entityType);
    if (!engine) {
      throw new FsmError(
        `No FSM engine registered for entity type: ${entityType}`,
        "INVALID_STATE",
        { entityType },
      );
    }
    return engine;
  }

  private async getCurrentState(entityType: EntityType, entityId: string): Promise<string> {
    switch (entityType) {
      case "PRIME_CONTRACT": {
        const [row] = await this.db
          .select({ status: contracts.status })
          .from(contracts)
          .where(eq(contracts.id, entityId));
        if (!row) throw new FsmError(`Contract ${entityId} not found`, "INVALID_STATE");
        return row.status;
      }
      case "MODIFICATION": {
        const [row] = await this.db
          .select({ status: modifications.status })
          .from(modifications)
          .where(eq(modifications.id, entityId));
        if (!row) throw new FsmError(`Modification ${entityId} not found`, "INVALID_STATE");
        return row.status;
      }
      case "NDA": {
        const [row] = await this.db
          .select({ status: ndas.status })
          .from(ndas)
          .where(eq(ndas.id, entityId));
        if (!row) throw new FsmError(`NDA ${entityId} not found`, "INVALID_STATE");
        return row.status;
      }
      case "MOU": {
        const [row] = await this.db
          .select({ status: mous.status })
          .from(mous)
          .where(eq(mous.id, entityId));
        if (!row) throw new FsmError(`MOU ${entityId} not found`, "INVALID_STATE");
        return row.status;
      }
      default:
        throw new FsmError(`Unknown entity type: ${entityType}`, "INVALID_STATE");
    }
  }

  private async persistState(entityType: EntityType, entityId: string, newState: string): Promise<void> {
    switch (entityType) {
      case "PRIME_CONTRACT":
        await this.db.update(contracts).set({ status: newState }).where(eq(contracts.id, entityId));
        break;
      case "MODIFICATION":
        await this.db.update(modifications).set({ status: newState }).where(eq(modifications.id, entityId));
        break;
      case "NDA":
        await this.db.update(ndas).set({ status: newState }).where(eq(ndas.id, entityId));
        break;
      case "MOU":
        await this.db.update(mous).set({ status: newState }).where(eq(mous.id, entityId));
        break;
    }
  }

  private createAuditLogger(): FsmAuditLogger {
    return {
      log: async (entry) => {
        await this.db.insert(auditLog).values({
          schemaName: entry.entityType,
          tableName: "fsm_transition",
          recordId: entry.entityId,
          action: "INSERT",
          oldValues: null,
          newValues: {
            from_state: entry.fromState,
            to_state: entry.toState,
            role: entry.role,
            success: entry.success,
            error_message: entry.errorMessage ?? null,
          },
          changedBy: entry.userId,
        });
      },
    };
  }
}
