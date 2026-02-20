import { describe, it, expect, beforeEach, vi } from "vitest";
import { FsmEngine } from "../engine.js";
import { FsmError } from "../types.js";
import type { FsmAuditLogger, TransitionContext } from "../types.js";
import {
  PRIME_CONTRACT_FSM,
  MODIFICATION_FSM,
  NDA_FSM,
  MOU_FSM,
} from "../machines.js";
import type {
  PrimeContractState,
  ModificationState,
  NdaState,
  MouState,
} from "../machines.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeEngine<S extends string>(config: Parameters<typeof FsmEngine<S>>[0]["config"] extends never ? never : any) {
  return new FsmEngine(config);
}

const contractEngine = () => new FsmEngine(PRIME_CONTRACT_FSM);
const modEngine = () => new FsmEngine(MODIFICATION_FSM);
const ndaEngine = () => new FsmEngine(NDA_FSM);
const mouEngine = () => new FsmEngine(MOU_FSM);

// ─── 1. Every valid transition in PRIME_CONTRACT_FSM ─────────────────

describe("PRIME_CONTRACT_FSM — valid transitions", () => {
  const transitions: Array<{ from: PrimeContractState; to: PrimeContractState; role: "system" | "contracts_team" | "contracts_manager" }> = [
    { from: "OPPORTUNITY_IDENTIFIED", to: "PROPOSAL_IN_PROGRESS", role: "contracts_team" },
    { from: "PROPOSAL_IN_PROGRESS", to: "PROPOSAL_SUBMITTED", role: "contracts_manager" },
    { from: "PROPOSAL_IN_PROGRESS", to: "OPPORTUNITY_IDENTIFIED", role: "contracts_team" },
    { from: "PROPOSAL_SUBMITTED", to: "AWARD_PENDING", role: "contracts_manager" },
    { from: "PROPOSAL_SUBMITTED", to: "NOT_AWARDED", role: "contracts_manager" },
    { from: "AWARD_PENDING", to: "AWARDED", role: "contracts_manager" },
    { from: "AWARDED", to: "ACTIVE", role: "contracts_manager" },
    { from: "ACTIVE", to: "OPTION_PENDING", role: "system" },
    { from: "ACTIVE", to: "MOD_IN_PROGRESS", role: "contracts_team" },
    { from: "ACTIVE", to: "STOP_WORK", role: "contracts_manager" },
    { from: "ACTIVE", to: "CLOSEOUT_PENDING", role: "contracts_manager" },
    { from: "ACTIVE", to: "TERMINATED", role: "contracts_manager" },
    { from: "OPTION_PENDING", to: "ACTIVE", role: "contracts_manager" },
    { from: "MOD_IN_PROGRESS", to: "ACTIVE", role: "contracts_manager" },
    { from: "STOP_WORK", to: "ACTIVE", role: "contracts_manager" },
    { from: "STOP_WORK", to: "TERMINATED", role: "contracts_manager" },
    { from: "CLOSEOUT_PENDING", to: "CLOSED", role: "contracts_manager" },
    { from: "TERMINATED", to: "CLOSED", role: "contracts_manager" },
  ];

  it.each(transitions)(
    "$from -> $to ($role)",
    async ({ from, to, role }) => {
      const engine = contractEngine();
      const result = await engine.transition(from, to, "user1", role);
      expect(result).toBe(to);
    },
  );
});

// ─── 2. Every valid transition in MODIFICATION_FSM ──────────────────

describe("MODIFICATION_FSM — valid transitions", () => {
  const transitions: Array<{ from: ModificationState; to: ModificationState; role: "system" | "contracts_team" | "contracts_manager" }> = [
    { from: "MOD_IDENTIFIED", to: "MOD_ANALYSIS", role: "system" },
    { from: "MOD_ANALYSIS", to: "MOD_DRAFTED", role: "system" },
    { from: "MOD_DRAFTED", to: "MOD_UNDER_REVIEW", role: "contracts_team" },
    { from: "MOD_UNDER_REVIEW", to: "MOD_SUBMITTED", role: "contracts_manager" },
    { from: "MOD_UNDER_REVIEW", to: "MOD_DRAFTED", role: "contracts_manager" },
    { from: "MOD_SUBMITTED", to: "MOD_NEGOTIATION", role: "contracts_team" },
    { from: "MOD_SUBMITTED", to: "MOD_EXECUTED", role: "contracts_manager" },
    { from: "MOD_NEGOTIATION", to: "MOD_EXECUTED", role: "contracts_manager" },
    { from: "MOD_NEGOTIATION", to: "MOD_WITHDRAWN", role: "contracts_manager" },
  ];

  it.each(transitions)(
    "$from -> $to ($role)",
    async ({ from, to, role }) => {
      const engine = modEngine();
      const result = await engine.transition(from, to, "user1", role);
      expect(result).toBe(to);
    },
  );
});

// ─── 3. Every valid transition in NDA_FSM ────────────────────────────

describe("NDA_FSM — valid transitions", () => {
  const transitions: Array<{ from: NdaState; to: NdaState; role: "system" | "contracts_team" | "contracts_manager" }> = [
    { from: "REQUESTED", to: "DRAFTED", role: "system" },
    { from: "DRAFTED", to: "INTERNAL_REVIEW", role: "contracts_team" },
    { from: "INTERNAL_REVIEW", to: "SENT_TO_COUNTERPARTY", role: "contracts_manager" },
    { from: "INTERNAL_REVIEW", to: "DRAFTED", role: "contracts_manager" },
    { from: "SENT_TO_COUNTERPARTY", to: "NEGOTIATION", role: "contracts_team" },
    { from: "SENT_TO_COUNTERPARTY", to: "EXECUTED", role: "contracts_manager" },
    { from: "NEGOTIATION", to: "EXECUTED", role: "contracts_manager" },
    { from: "NEGOTIATION", to: "TERMINATED", role: "contracts_manager" },
    { from: "EXECUTED", to: "EXPIRED", role: "system" },
    { from: "EXECUTED", to: "RENEWED", role: "contracts_manager" },
    { from: "EXECUTED", to: "TERMINATED", role: "contracts_manager" },
    { from: "EXPIRED", to: "RENEWED", role: "contracts_manager" },
    { from: "RENEWED", to: "EXECUTED", role: "contracts_manager" },
  ];

  it.each(transitions)(
    "$from -> $to ($role)",
    async ({ from, to, role }) => {
      const engine = ndaEngine();
      const result = await engine.transition(from, to, "user1", role);
      expect(result).toBe(to);
    },
  );
});

// ─── 4. Every valid transition in MOU_FSM ────────────────────────────

describe("MOU_FSM — valid transitions", () => {
  const transitions: Array<{ from: MouState; to: MouState; role: "system" | "contracts_team" | "contracts_manager" }> = [
    { from: "REQUESTED", to: "DRAFTED", role: "system" },
    { from: "DRAFTED", to: "INTERNAL_REVIEW", role: "contracts_team" },
    { from: "INTERNAL_REVIEW", to: "SENT_TO_COUNTERPARTY", role: "contracts_manager" },
    { from: "INTERNAL_REVIEW", to: "DRAFTED", role: "contracts_manager" },
    { from: "SENT_TO_COUNTERPARTY", to: "NEGOTIATION", role: "contracts_team" },
    { from: "SENT_TO_COUNTERPARTY", to: "EXECUTED", role: "contracts_manager" },
    { from: "NEGOTIATION", to: "EXECUTED", role: "contracts_manager" },
    { from: "NEGOTIATION", to: "TERMINATED", role: "contracts_manager" },
    { from: "EXECUTED", to: "EXPIRED", role: "system" },
    { from: "EXECUTED", to: "RENEWED", role: "contracts_manager" },
    { from: "EXECUTED", to: "TERMINATED", role: "contracts_manager" },
    { from: "EXPIRED", to: "RENEWED", role: "contracts_manager" },
    { from: "RENEWED", to: "EXECUTED", role: "contracts_manager" },
  ];

  it.each(transitions)(
    "$from -> $to ($role)",
    async ({ from, to, role }) => {
      const engine = mouEngine();
      const result = await engine.transition(from, to, "user1", role);
      expect(result).toBe(to);
    },
  );
});

// ─── 5. Invalid transitions throw appropriate errors ─────────────────

describe("Invalid transitions", () => {
  it("should throw INVALID_TRANSITION for a disallowed path", async () => {
    const engine = contractEngine();
    await expect(
      engine.transition("OPPORTUNITY_IDENTIFIED", "ACTIVE", "user1", "contracts_manager"),
    ).rejects.toThrow(FsmError);

    try {
      await engine.transition("OPPORTUNITY_IDENTIFIED", "ACTIVE", "user1", "contracts_manager");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("should throw INVALID_STATE for an unknown state", async () => {
    const engine = contractEngine();
    await expect(
      engine.transition("NONEXISTENT" as any, "ACTIVE", "user1", "contracts_manager"),
    ).rejects.toThrow(FsmError);

    try {
      await engine.transition("NONEXISTENT" as any, "ACTIVE", "user1", "contracts_manager");
    } catch (e) {
      expect((e as FsmError).code).toBe("INVALID_STATE");
    }
  });

  it("should throw for backward transitions that aren't defined", async () => {
    const engine = contractEngine();
    // ACTIVE -> AWARDED is not a valid backward transition
    await expect(
      engine.transition("ACTIVE", "AWARDED", "user1", "contracts_manager"),
    ).rejects.toThrow(FsmError);
  });

  it("should throw for terminal state transitions (CLOSED has no outbound)", async () => {
    const engine = contractEngine();
    await expect(
      engine.transition("CLOSED", "ACTIVE", "user1", "contracts_manager"),
    ).rejects.toThrow(FsmError);
  });

  it("should throw for NOT_AWARDED to any state (terminal)", async () => {
    const engine = contractEngine();
    await expect(
      engine.transition("NOT_AWARDED", "OPPORTUNITY_IDENTIFIED", "user1", "contracts_team"),
    ).rejects.toThrow(FsmError);
  });
});

// ─── 6. Role-based authorization ─────────────────────────────────────

describe("Role-based authorization", () => {
  it("should reject contracts_team for contracts_manager transitions", async () => {
    const engine = contractEngine();
    // AWARDED -> ACTIVE requires contracts_manager
    await expect(
      engine.transition("AWARDED", "ACTIVE", "user1", "contracts_team"),
    ).rejects.toThrow(FsmError);

    try {
      await engine.transition("AWARDED", "ACTIVE", "user1", "contracts_team");
    } catch (e) {
      expect((e as FsmError).code).toBe("UNAUTHORIZED_ROLE");
    }
  });

  it("should reject contracts_team for system transitions", async () => {
    const engine = contractEngine();
    // ACTIVE -> OPTION_PENDING requires system
    await expect(
      engine.transition("ACTIVE", "OPTION_PENDING", "user1", "contracts_team"),
    ).rejects.toThrow(FsmError);
  });

  it("should reject contracts_manager for system transitions", async () => {
    const engine = contractEngine();
    // ACTIVE -> OPTION_PENDING requires system
    await expect(
      engine.transition("ACTIVE", "OPTION_PENDING", "user1", "contracts_manager"),
    ).rejects.toThrow(FsmError);
  });

  it("should allow contracts_manager to perform contracts_team transitions", async () => {
    const engine = contractEngine();
    // OPPORTUNITY_IDENTIFIED -> PROPOSAL_IN_PROGRESS requires contracts_team
    // contracts_manager should also be able to do this
    const result = await engine.transition(
      "OPPORTUNITY_IDENTIFIED",
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_manager",
    );
    expect(result).toBe("PROPOSAL_IN_PROGRESS");
  });

  it("system role can only perform system transitions", async () => {
    const engine = contractEngine();
    // system role should not be able to do contracts_team transitions
    await expect(
      engine.transition("OPPORTUNITY_IDENTIFIED", "PROPOSAL_IN_PROGRESS", "sys", "system"),
    ).rejects.toThrow(FsmError);
  });
});

// ─── 7. on_enter and on_exit hooks ──────────────────────────────────

describe("Hooks", () => {
  it("should fire on_exit hook when leaving a state", async () => {
    const engine = contractEngine();
    const exitHook = vi.fn();

    engine.onExit("OPPORTUNITY_IDENTIFIED", exitHook);
    await engine.transition(
      "OPPORTUNITY_IDENTIFIED",
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
    );

    expect(exitHook).toHaveBeenCalledOnce();
    expect(exitHook).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "OPPORTUNITY_IDENTIFIED",
        to: "PROPOSAL_IN_PROGRESS",
        userId: "user1",
        role: "contracts_team",
      }),
    );
  });

  it("should fire on_enter hook when entering a state", async () => {
    const engine = contractEngine();
    const enterHook = vi.fn();

    engine.onEnter("PROPOSAL_IN_PROGRESS", enterHook);
    await engine.transition(
      "OPPORTUNITY_IDENTIFIED",
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
    );

    expect(enterHook).toHaveBeenCalledOnce();
    expect(enterHook).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "OPPORTUNITY_IDENTIFIED",
        to: "PROPOSAL_IN_PROGRESS",
      }),
    );
  });

  it("should fire on_exit before on_enter", async () => {
    const engine = contractEngine();
    const order: string[] = [];

    engine.onExit("OPPORTUNITY_IDENTIFIED", () => { order.push("exit"); });
    engine.onEnter("PROPOSAL_IN_PROGRESS", () => { order.push("enter"); });

    await engine.transition(
      "OPPORTUNITY_IDENTIFIED",
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
    );

    expect(order).toEqual(["exit", "enter"]);
  });

  it("should throw HOOK_FAILED if on_exit hook throws", async () => {
    const engine = contractEngine();
    engine.onExit("OPPORTUNITY_IDENTIFIED", () => {
      throw new Error("exit hook failed");
    });

    try {
      await engine.transition(
        "OPPORTUNITY_IDENTIFIED",
        "PROPOSAL_IN_PROGRESS",
        "user1",
        "contracts_team",
      );
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("HOOK_FAILED");
      expect((e as FsmError).message).toContain("on_exit hook failed");
    }
  });

  it("should throw HOOK_FAILED if on_enter hook throws", async () => {
    const engine = contractEngine();
    engine.onEnter("PROPOSAL_IN_PROGRESS", () => {
      throw new Error("enter hook failed");
    });

    try {
      await engine.transition(
        "OPPORTUNITY_IDENTIFIED",
        "PROPOSAL_IN_PROGRESS",
        "user1",
        "contracts_team",
      );
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("HOOK_FAILED");
      expect((e as FsmError).message).toContain("on_enter hook failed");
    }
  });

  it("should support multiple hooks per state", async () => {
    const engine = contractEngine();
    const hook1 = vi.fn();
    const hook2 = vi.fn();

    engine.onEnter("PROPOSAL_IN_PROGRESS", hook1);
    engine.onEnter("PROPOSAL_IN_PROGRESS", hook2);

    await engine.transition(
      "OPPORTUNITY_IDENTIFIED",
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
    );

    expect(hook1).toHaveBeenCalledOnce();
    expect(hook2).toHaveBeenCalledOnce();
  });
});

// ─── 8. Full lifecycle: OPPORTUNITY_IDENTIFIED -> CLOSED ─────────────

describe("Full contract lifecycle", () => {
  it("should complete the full prime contract lifecycle", async () => {
    const engine = contractEngine();
    let state: string = "OPPORTUNITY_IDENTIFIED";

    const steps: Array<{ to: PrimeContractState; role: "system" | "contracts_team" | "contracts_manager" }> = [
      { to: "PROPOSAL_IN_PROGRESS", role: "contracts_team" },
      { to: "PROPOSAL_SUBMITTED", role: "contracts_manager" },
      { to: "AWARD_PENDING", role: "contracts_manager" },
      { to: "AWARDED", role: "contracts_manager" },
      { to: "ACTIVE", role: "contracts_manager" },
      { to: "CLOSEOUT_PENDING", role: "contracts_manager" },
      { to: "CLOSED", role: "contracts_manager" },
    ];

    for (const step of steps) {
      state = await engine.transition(state as PrimeContractState, step.to, "user1", step.role);
      expect(state).toBe(step.to);
    }

    expect(state).toBe("CLOSED");
  });

  it("should handle stop-work and resume scenario", async () => {
    const engine = contractEngine();
    let state: PrimeContractState = "ACTIVE";

    state = await engine.transition(state, "STOP_WORK", "mgr", "contracts_manager") as PrimeContractState;
    expect(state).toBe("STOP_WORK");

    state = await engine.transition(state, "ACTIVE", "mgr", "contracts_manager") as PrimeContractState;
    expect(state).toBe("ACTIVE");
  });

  it("should handle option pending and return to active", async () => {
    const engine = contractEngine();
    let state: PrimeContractState = "ACTIVE";

    state = await engine.transition(state, "OPTION_PENDING", "sys", "system") as PrimeContractState;
    expect(state).toBe("OPTION_PENDING");

    state = await engine.transition(state, "ACTIVE", "mgr", "contracts_manager") as PrimeContractState;
    expect(state).toBe("ACTIVE");
  });

  it("should handle termination path", async () => {
    const engine = contractEngine();
    let state: PrimeContractState = "ACTIVE";

    state = await engine.transition(state, "TERMINATED", "mgr", "contracts_manager") as PrimeContractState;
    expect(state).toBe("TERMINATED");

    state = await engine.transition(state, "CLOSED", "mgr", "contracts_manager") as PrimeContractState;
    expect(state).toBe("CLOSED");
  });
});

// ─── 9. Modification lifecycle ───────────────────────────────────────

describe("Modification lifecycle", () => {
  it("should complete the full modification lifecycle", async () => {
    const engine = modEngine();
    let state: string = "MOD_IDENTIFIED";

    const steps: Array<{ to: ModificationState; role: "system" | "contracts_team" | "contracts_manager" }> = [
      { to: "MOD_ANALYSIS", role: "system" },
      { to: "MOD_DRAFTED", role: "system" },
      { to: "MOD_UNDER_REVIEW", role: "contracts_team" },
      { to: "MOD_SUBMITTED", role: "contracts_manager" },
      { to: "MOD_NEGOTIATION", role: "contracts_team" },
      { to: "MOD_EXECUTED", role: "contracts_manager" },
    ];

    for (const step of steps) {
      state = await engine.transition(state as ModificationState, step.to, "user1", step.role);
      expect(state).toBe(step.to);
    }

    expect(state).toBe("MOD_EXECUTED");
  });

  it("should handle revision loop (review -> drafted -> review)", async () => {
    const engine = modEngine();
    let state: ModificationState = "MOD_UNDER_REVIEW";

    state = await engine.transition(state, "MOD_DRAFTED", "mgr", "contracts_manager") as ModificationState;
    expect(state).toBe("MOD_DRAFTED");

    state = await engine.transition(state, "MOD_UNDER_REVIEW", "team", "contracts_team") as ModificationState;
    expect(state).toBe("MOD_UNDER_REVIEW");
  });
});

// ─── 10. NDA lifecycle ──────────────────────────────────────────────

describe("NDA lifecycle", () => {
  it("should complete the NDA lifecycle through to EXECUTED", async () => {
    const engine = ndaEngine();
    let state: string = "REQUESTED";

    const steps: Array<{ to: NdaState; role: "system" | "contracts_team" | "contracts_manager" }> = [
      { to: "DRAFTED", role: "system" },
      { to: "INTERNAL_REVIEW", role: "contracts_team" },
      { to: "SENT_TO_COUNTERPARTY", role: "contracts_manager" },
      { to: "NEGOTIATION", role: "contracts_team" },
      { to: "EXECUTED", role: "contracts_manager" },
    ];

    for (const step of steps) {
      state = await engine.transition(state as NdaState, step.to, "user1", step.role);
    }

    expect(state).toBe("EXECUTED");
  });

  it("should handle renewal cycle", async () => {
    const engine = ndaEngine();
    let state: NdaState = "EXECUTED";

    state = await engine.transition(state, "EXPIRED", "sys", "system") as NdaState;
    expect(state).toBe("EXPIRED");

    state = await engine.transition(state, "RENEWED", "mgr", "contracts_manager") as NdaState;
    expect(state).toBe("RENEWED");

    state = await engine.transition(state, "EXECUTED", "mgr", "contracts_manager") as NdaState;
    expect(state).toBe("EXECUTED");
  });
});

// ─── 11. Parallel states ─────────────────────────────────────────────

describe("Parallel states", () => {
  it("contract can be ACTIVE while a modification is MOD_IN_PROGRESS", async () => {
    const cEngine = contractEngine();
    const mEngine = modEngine();

    // Contract is ACTIVE
    let contractState = "ACTIVE" as PrimeContractState;

    // Contract transitions to MOD_IN_PROGRESS
    contractState = await cEngine.transition(
      contractState,
      "MOD_IN_PROGRESS",
      "team",
      "contracts_team",
    ) as PrimeContractState;
    expect(contractState).toBe("MOD_IN_PROGRESS");

    // Meanwhile, the modification entity proceeds through its own lifecycle
    let modState = "MOD_IDENTIFIED" as ModificationState;
    modState = await mEngine.transition(modState, "MOD_ANALYSIS", "sys", "system") as ModificationState;
    modState = await mEngine.transition(modState, "MOD_DRAFTED", "sys", "system") as ModificationState;
    modState = await mEngine.transition(modState, "MOD_UNDER_REVIEW", "team", "contracts_team") as ModificationState;

    // Both FSMs operate independently
    expect(contractState).toBe("MOD_IN_PROGRESS");
    expect(modState).toBe("MOD_UNDER_REVIEW");

    // Mod completes
    modState = await mEngine.transition(modState, "MOD_SUBMITTED", "mgr", "contracts_manager") as ModificationState;
    modState = await mEngine.transition(modState, "MOD_EXECUTED", "mgr", "contracts_manager") as ModificationState;
    expect(modState).toBe("MOD_EXECUTED");

    // Contract returns to ACTIVE
    contractState = await cEngine.transition(
      contractState,
      "ACTIVE",
      "mgr",
      "contracts_manager",
    ) as PrimeContractState;
    expect(contractState).toBe("ACTIVE");
  });
});

// ─── 12. Audit logger integration ───────────────────────────────────

describe("Audit logging", () => {
  it("should call audit logger on successful transitions", async () => {
    const engine = contractEngine();
    const mockLogger: FsmAuditLogger = { log: vi.fn() };
    engine.setAuditLogger(mockLogger);

    await engine.transition(
      "OPPORTUNITY_IDENTIFIED",
      "PROPOSAL_IN_PROGRESS",
      "user1",
      "contracts_team",
      "contract-123",
    );

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "PRIME_CONTRACT",
        entityId: "contract-123",
        fromState: "OPPORTUNITY_IDENTIFIED",
        toState: "PROPOSAL_IN_PROGRESS",
        userId: "user1",
        role: "contracts_team",
        success: true,
      }),
    );
  });

  it("should call audit logger on failed transitions", async () => {
    const engine = contractEngine();
    const mockLogger: FsmAuditLogger = { log: vi.fn() };
    engine.setAuditLogger(mockLogger);

    await expect(
      engine.transition("CLOSED", "ACTIVE", "user1", "contracts_manager", "contract-456"),
    ).rejects.toThrow();

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "contract-456",
        success: false,
        errorMessage: expect.stringContaining("not allowed"),
      }),
    );
  });

  it("should call audit logger on authorization failures", async () => {
    const engine = contractEngine();
    const mockLogger: FsmAuditLogger = { log: vi.fn() };
    engine.setAuditLogger(mockLogger);

    await expect(
      engine.transition("AWARDED", "ACTIVE", "user1", "contracts_team", "c-789"),
    ).rejects.toThrow();

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorMessage: expect.stringContaining("not authorized"),
      }),
    );
  });
});

// ─── 13. getAvailableTransitions ─────────────────────────────────────

describe("getAvailableTransitions", () => {
  it("should return correct transitions for ACTIVE state as contracts_manager", () => {
    const engine = contractEngine();
    const transitions = engine.getAvailableTransitions("ACTIVE", "contracts_manager");

    const targets = transitions.map((t) => t.to);
    expect(targets).toContain("MOD_IN_PROGRESS");
    expect(targets).toContain("STOP_WORK");
    expect(targets).toContain("CLOSEOUT_PENDING");
    expect(targets).toContain("TERMINATED");
    // system-only transition should not be available
    expect(targets).not.toContain("OPTION_PENDING");
  });

  it("should return system transitions only for system role", () => {
    const engine = contractEngine();
    const transitions = engine.getAvailableTransitions("ACTIVE", "system");

    const targets = transitions.map((t) => t.to);
    expect(targets).toContain("OPTION_PENDING");
    expect(targets).not.toContain("MOD_IN_PROGRESS");
  });

  it("should return empty array for terminal states", () => {
    const engine = contractEngine();
    expect(engine.getAvailableTransitions("CLOSED", "contracts_manager")).toEqual([]);
    expect(engine.getAvailableTransitions("NOT_AWARDED", "contracts_manager")).toEqual([]);
  });
});
