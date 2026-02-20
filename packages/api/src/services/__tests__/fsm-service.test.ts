import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { FsmService } from "../fsm-service.js";
import { FsmError } from "@forge/shared";
import { contracts, parties, ndas, mous, modifications } from "../../db/schema.js";
import { auditLog } from "../../db/schema-audit.js";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let fsmService: FsmService;

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 5 });
  db = drizzle(client);

  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  const migrationsPath = new URL("../../db/migrations", import.meta.url).pathname;
  await migrate(db, { migrationsFolder: migrationsPath });

  fsmService = new FsmService(db);
}, 60_000);

afterAll(async () => {
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");
  await client.end();
});

beforeEach(async () => {
  await client.unsafe("SET session_replication_role = 'replica'");
  await db.delete(modifications);
  await db.delete(ndas);
  await db.delete(mous);
  await db.delete(parties);
  await db.delete(contracts);
  await client.unsafe("DELETE FROM audit.audit_log");
  await client.unsafe("SET session_replication_role = 'origin'");
});

// ─── Helper: insert a contract at a given state ──────────────────────

async function insertContract(status: string = "OPPORTUNITY_IDENTIFIED") {
  const [c] = await db
    .insert(contracts)
    .values({
      contractNumber: `FSM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contractType: "FFP",
      awardingAgency: "DoD",
      contractingOfficerName: "Jane",
      contractingOfficerEmail: "jane@dod.mil",
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
      ceilingValue: "1000000.00",
      fundedValue: "500000.00",
      status,
    })
    .returning();
  return c!;
}

async function insertModification(contractId: string, status: string = "MOD_IDENTIFIED") {
  const [m] = await db
    .insert(modifications)
    .values({
      contractId,
      modNumber: `MOD-${Date.now()}`,
      modType: "FUNDING",
      effectiveDate: "2024-06-01",
      status,
    })
    .returning();
  return m!;
}

async function insertNda(status: string = "REQUESTED") {
  const [partyA] = await db.insert(parties).values({ name: "Party A" }).returning();
  const [partyB] = await db.insert(parties).values({ name: "Party B" }).returning();
  const [n] = await db
    .insert(ndas)
    .values({
      partyAId: partyA!.id,
      partyBId: partyB!.id,
      effectiveDate: "2024-01-01",
      expirationDate: "2025-01-01",
      ndaType: "MUTUAL",
      status,
    })
    .returning();
  return n!;
}

// ─── 1. Transitions are persisted to the database ────────────────────

describe("FSM Service — Persistence", () => {
  it("should persist state transitions to the database", async () => {
    const contract = await insertContract("OPPORTUNITY_IDENTIFIED");

    await fsmService.transition(
      "PRIME_CONTRACT",
      contract.id,
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
    );

    // Verify the contract status was updated in the database
    const [updated] = await db
      .select({ status: contracts.status })
      .from(contracts)
      .where(eq(contracts.id, contract.id));

    expect(updated!.status).toBe("PROPOSAL_IN_PROGRESS");
  });

  it("should persist multiple sequential transitions", async () => {
    const contract = await insertContract("OPPORTUNITY_IDENTIFIED");

    await fsmService.transition("PRIME_CONTRACT", contract.id, "PROPOSAL_IN_PROGRESS", "u1", "contracts_team");
    await fsmService.transition("PRIME_CONTRACT", contract.id, "PROPOSAL_SUBMITTED", "u1", "contracts_manager");
    await fsmService.transition("PRIME_CONTRACT", contract.id, "AWARD_PENDING", "u1", "contracts_manager");

    const [final] = await db
      .select({ status: contracts.status })
      .from(contracts)
      .where(eq(contracts.id, contract.id));

    expect(final!.status).toBe("AWARD_PENDING");
  });
});

// ─── 2. Audit log entries are created ────────────────────────────────

describe("FSM Service — Audit Logging", () => {
  it("should create audit log entries for each transition", async () => {
    const contract = await insertContract("OPPORTUNITY_IDENTIFIED");

    await fsmService.transition(
      "PRIME_CONTRACT",
      contract.id,
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
    );

    // Query audit log for FSM transition entries
    const logs = await db
      .select()
      .from(auditLog)
      .where(
        sql`${auditLog.tableName} = 'fsm_transition'
            AND ${auditLog.recordId} = ${contract.id}`,
      );

    expect(logs.length).toBeGreaterThanOrEqual(1);

    const transitionLog = logs.find((l) => {
      const nv = l.newValues as Record<string, unknown> | null;
      return nv?.["success"] === true;
    });
    expect(transitionLog).toBeDefined();

    const newVals = transitionLog!.newValues as Record<string, unknown>;
    expect(newVals["from_state"]).toBe("OPPORTUNITY_IDENTIFIED");
    expect(newVals["to_state"]).toBe("PROPOSAL_IN_PROGRESS");
    expect(newVals["role"]).toBe("contracts_team");
    expect(transitionLog!.changedBy).toBe("user1");
  });

  it("should create audit log entries for failed transitions too", async () => {
    const contract = await insertContract("OPPORTUNITY_IDENTIFIED");

    await expect(
      fsmService.transition("PRIME_CONTRACT", contract.id, "ACTIVE", "user1", "contracts_team"),
    ).rejects.toThrow();

    const logs = await db
      .select()
      .from(auditLog)
      .where(
        sql`${auditLog.tableName} = 'fsm_transition'
            AND ${auditLog.recordId} = ${contract.id}`,
      );

    const failedLog = logs.find((l) => {
      const nv = l.newValues as Record<string, unknown> | null;
      return nv?.["success"] === false;
    });
    expect(failedLog).toBeDefined();

    const newVals = failedLog!.newValues as Record<string, unknown>;
    expect(newVals["error_message"]).toBeTruthy();
  });
});

// ─── 3. getAvailableTransitions ──────────────────────────────────────

describe("FSM Service — getAvailableTransitions", () => {
  it("should return correct transitions based on role", async () => {
    const contract = await insertContract("ACTIVE");

    const managerTransitions = await fsmService.getAvailableTransitions(
      "PRIME_CONTRACT",
      contract.id,
      "contracts_manager",
    );

    const targets = managerTransitions.map((t) => t.to);
    expect(targets).toContain("MOD_IN_PROGRESS");
    expect(targets).toContain("STOP_WORK");
    expect(targets).toContain("CLOSEOUT_PENDING");
    expect(targets).toContain("TERMINATED");
    // system-only should not appear
    expect(targets).not.toContain("OPTION_PENDING");
  });

  it("should return empty for terminal states", async () => {
    const contract = await insertContract("CLOSED");

    const transitions = await fsmService.getAvailableTransitions(
      "PRIME_CONTRACT",
      contract.id,
      "contracts_manager",
    );

    expect(transitions).toEqual([]);
  });

  it("should return different transitions for different roles", async () => {
    const contract = await insertContract("ACTIVE");

    const teamTransitions = await fsmService.getAvailableTransitions(
      "PRIME_CONTRACT",
      contract.id,
      "contracts_team",
    );
    const sysTransitions = await fsmService.getAvailableTransitions(
      "PRIME_CONTRACT",
      contract.id,
      "system",
    );

    expect(teamTransitions.map((t) => t.to)).toContain("MOD_IN_PROGRESS");
    expect(sysTransitions.map((t) => t.to)).toContain("OPTION_PENDING");
    expect(sysTransitions.map((t) => t.to)).not.toContain("MOD_IN_PROGRESS");
  });
});

// ─── 4. getHistory ───────────────────────────────────────────────────

describe("FSM Service — getHistory", () => {
  it("should return chronological transition history", async () => {
    const contract = await insertContract("OPPORTUNITY_IDENTIFIED");

    await fsmService.transition("PRIME_CONTRACT", contract.id, "PROPOSAL_IN_PROGRESS", "u1", "contracts_team");
    await fsmService.transition("PRIME_CONTRACT", contract.id, "PROPOSAL_SUBMITTED", "u1", "contracts_manager");
    await fsmService.transition("PRIME_CONTRACT", contract.id, "AWARD_PENDING", "u2", "contracts_manager");

    const history = await fsmService.getHistory("PRIME_CONTRACT", contract.id);

    expect(history.length).toBe(3);

    expect(history[0]!.fromState).toBe("OPPORTUNITY_IDENTIFIED");
    expect(history[0]!.toState).toBe("PROPOSAL_IN_PROGRESS");
    expect(history[0]!.success).toBe(true);

    expect(history[1]!.fromState).toBe("PROPOSAL_IN_PROGRESS");
    expect(history[1]!.toState).toBe("PROPOSAL_SUBMITTED");

    expect(history[2]!.fromState).toBe("PROPOSAL_SUBMITTED");
    expect(history[2]!.toState).toBe("AWARD_PENDING");
    expect(history[2]!.userId).toBe("u2");
  });
});

// ─── 5. Invalid transitions rejected at service level ────────────────

describe("FSM Service — Rejection", () => {
  it("should reject invalid transitions and not change state", async () => {
    const contract = await insertContract("OPPORTUNITY_IDENTIFIED");

    await expect(
      fsmService.transition("PRIME_CONTRACT", contract.id, "CLOSED", "u1", "contracts_manager"),
    ).rejects.toThrow(FsmError);

    // State should remain unchanged
    const [unchanged] = await db
      .select({ status: contracts.status })
      .from(contracts)
      .where(eq(contracts.id, contract.id));

    expect(unchanged!.status).toBe("OPPORTUNITY_IDENTIFIED");
  });

  it("should reject unauthorized role and not change state", async () => {
    const contract = await insertContract("AWARDED");

    await expect(
      fsmService.transition("PRIME_CONTRACT", contract.id, "ACTIVE", "u1", "contracts_team"),
    ).rejects.toThrow(FsmError);

    const [unchanged] = await db
      .select({ status: contracts.status })
      .from(contracts)
      .where(eq(contracts.id, contract.id));

    expect(unchanged!.status).toBe("AWARDED");
  });

  it("should throw for non-existent entity", async () => {
    await expect(
      fsmService.transition(
        "PRIME_CONTRACT",
        "00000000-0000-0000-0000-000000000000",
        "ACTIVE",
        "u1",
        "contracts_manager",
      ),
    ).rejects.toThrow(FsmError);
  });

  it("should work for modification entities", async () => {
    const contract = await insertContract("ACTIVE");
    const mod = await insertModification(contract.id, "MOD_DRAFTED");

    await fsmService.transition(
      "MODIFICATION",
      mod.id,
      "MOD_UNDER_REVIEW",
      "u1",
      "contracts_team",
    );

    const [updated] = await db
      .select({ status: modifications.status })
      .from(modifications)
      .where(eq(modifications.id, mod.id));

    expect(updated!.status).toBe("MOD_UNDER_REVIEW");
  });
});
