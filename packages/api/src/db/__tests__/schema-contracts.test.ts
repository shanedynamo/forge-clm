import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import {
  contracts,
  contractOptions,
  modifications,
  clins,
  deliverables,
  subcontracts,
  parties,
  ndas,
  mous,
  mouParties,
  contractClauses,
  clauseLibrary,
  flowdownRequirements,
  complianceMilestones,
  governmentProperty,
  smallBusinessPlans,
  contractRequests,
  approvalQueue,
  communicationsLog,
  contractTypeEnum,
  securityLevelEnum,
  optionStatusEnum,
  modTypeEnum,
  clinTypeEnum,
  frequencyEnum,
  deliverableStatusEnum,
  businessSizeEnum,
  ndaTypeEnum,
  clauseTypeEnum,
  riskCategoryEnum,
  flowdownStatusEnum,
  recurrenceEnum,
  milestoneStatusEnum,
  propertyTypeEnum,
  propertyStatusEnum,
  sbPlanTypeEnum,
  sbPlanStatusEnum,
  requestTypeEnum,
  priorityEnum,
  approvalStatusEnum,
  commDirectionEnum,
  commChannelEnum,
} from "../schema.js";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgresql://forge:forge@localhost:5433/forge_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 5 });
  db = drizzle(client);

  // Clean slate: drop and re-create
  await client.unsafe("DROP SCHEMA IF EXISTS contracts CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS vectors CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS audit CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS agents CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP EXTENSION IF EXISTS vector CASCADE");

  // Run migrations
  const migrationsPath = new URL("../migrations", import.meta.url).pathname;
  await migrate(db, { migrationsFolder: migrationsPath });
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

// Helper: clean all data between tests (reverse FK order)
// Disable audit triggers during cleanup to avoid cascading audit entries
beforeEach(async () => {
  await client.unsafe("SET session_replication_role = 'replica'");
  await db.delete(flowdownRequirements);
  await db.delete(communicationsLog);
  await db.delete(approvalQueue);
  await db.delete(contractRequests);
  await db.delete(governmentProperty);
  await db.delete(smallBusinessPlans);
  await db.delete(complianceMilestones);
  await db.delete(deliverables);
  await db.delete(contractClauses);
  await db.delete(clins);
  await db.delete(subcontracts);
  await db.delete(modifications);
  await db.delete(contractOptions);
  await db.delete(mouParties);
  await db.delete(ndas);
  await db.delete(mous);
  await db.delete(parties);
  await db.delete(clauseLibrary);
  await db.delete(contracts);
  await client.unsafe("DELETE FROM audit.audit_log");
  await client.unsafe("SET session_replication_role = 'origin'");
});

// ─── Helper to insert a base contract ──────────────────────────────

function sampleContractValues(overrides: Record<string, unknown> = {}) {
  return {
    contractNumber: "FA8721-24-C-0001",
    contractType: "FFP" as const,
    awardingAgency: "US Air Force",
    contractingOfficerName: "Jane Smith",
    contractingOfficerEmail: "jane.smith@us.af.mil",
    corName: "John Doe",
    corEmail: "john.doe@us.af.mil",
    popStart: "2024-01-01",
    popEnd: "2025-12-31",
    ceilingValue: "5000000.00",
    fundedValue: "2500000.00",
    naicsCode: "541512",
    pscCode: "D302",
    securityLevel: "CUI" as const,
    cageCode: "1ABC2",
    dunsUei: "ABC1234567890",
    status: "ACTIVE",
    description: "IT modernization services for AFMC",
    ...overrides,
  };
}

// ─── 1. All 19 tables can be created via migration ─────────────────

describe("Table creation via migration", () => {
  it("should create all 19 tables in the contracts schema", async () => {
    const result = await client.unsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'contracts'
      ORDER BY table_name
    `);

    const tableNames = result.map((r: Record<string, string>) => r["table_name"]);
    expect(tableNames).toEqual([
      "approval_queue",
      "clause_library",
      "clins",
      "communications_log",
      "compliance_milestones",
      "contract_clauses",
      "contract_options",
      "contract_requests",
      "contracts",
      "deliverables",
      "flowdown_requirements",
      "government_property",
      "modifications",
      "mou_parties",
      "mous",
      "ndas",
      "parties",
      "small_business_plans",
      "subcontracts",
    ]);
  });
});

// ─── 2. All enum types are properly defined ─────────────────────────

describe("Enum type definitions", () => {
  it("should have all 23 enum types in the contracts schema", async () => {
    const result = await client.unsafe(`
      SELECT typname FROM pg_type
      JOIN pg_namespace ON pg_type.typnamespace = pg_namespace.oid
      WHERE nspname = 'contracts' AND typtype = 'e'
      ORDER BY typname
    `);

    const enumNames = result.map((r: Record<string, string>) => r["typname"]);
    expect(enumNames).toEqual([
      "approval_status",
      "business_size",
      "clause_type",
      "clin_type",
      "comm_channel",
      "comm_direction",
      "contract_type",
      "deliverable_status",
      "flowdown_status",
      "frequency",
      "milestone_status",
      "mod_type",
      "nda_type",
      "option_status",
      "priority",
      "property_status",
      "property_type",
      "recurrence",
      "request_type",
      "risk_category",
      "sb_plan_status",
      "sb_plan_type",
      "security_level",
    ]);
  });

  it("should have correct values for contract_type enum", async () => {
    const result = await client.unsafe(`
      SELECT unnest(enum_range(NULL::contracts.contract_type))::text AS val
    `);
    const values = result.map((r: Record<string, string>) => r["val"]);
    expect(values).toEqual(["FFP", "CPFF", "T_AND_M", "IDIQ", "BPA", "COST_PLUS", "HYBRID"]);
  });

  it("should have correct values for security_level enum", async () => {
    const result = await client.unsafe(`
      SELECT unnest(enum_range(NULL::contracts.security_level))::text AS val
    `);
    const values = result.map((r: Record<string, string>) => r["val"]);
    expect(values).toEqual(["UNCLASSIFIED", "CUI", "SECRET", "TOP_SECRET"]);
  });

  it("should have correct values for mod_type enum", async () => {
    const result = await client.unsafe(`
      SELECT unnest(enum_range(NULL::contracts.mod_type))::text AS val
    `);
    const values = result.map((r: Record<string, string>) => r["val"]);
    expect(values).toEqual([
      "ADMIN", "FUNDING", "SCOPE", "OPTION_EXERCISE",
      "TERMINATION", "NOVATION", "NAME_CHANGE",
    ]);
  });

  it("should have correct values for clause_type enum", async () => {
    const result = await client.unsafe(`
      SELECT unnest(enum_range(NULL::contracts.clause_type))::text AS val
    `);
    const values = result.map((r: Record<string, string>) => r["val"]);
    expect(values).toEqual(["FAR", "DFARS", "AGENCY_SUPPLEMENT"]);
  });

  it("should have correct values for risk_category enum", async () => {
    const result = await client.unsafe(`
      SELECT unnest(enum_range(NULL::contracts.risk_category))::text AS val
    `);
    const values = result.map((r: Record<string, string>) => r["val"]);
    expect(values).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNASSESSED"]);
  });
});

// ─── 3. Insert a sample contract with all required fields ───────────

describe("Contract CRUD", () => {
  it("should insert a contract with all required fields and return it", async () => {
    const [inserted] = await db.insert(contracts).values(sampleContractValues()).returning();

    expect(inserted).toBeDefined();
    expect(inserted!.id).toBeDefined();
    expect(inserted!.contractNumber).toBe("FA8721-24-C-0001");
    expect(inserted!.contractType).toBe("FFP");
    expect(inserted!.awardingAgency).toBe("US Air Force");
    expect(inserted!.ceilingValue).toBe("5000000.00");
    expect(inserted!.fundedValue).toBe("2500000.00");
    expect(inserted!.securityLevel).toBe("CUI");
    expect(inserted!.naicsCode).toBe("541512");
    expect(inserted!.pscCode).toBe("D302");
    expect(inserted!.status).toBe("ACTIVE");
    expect(inserted!.createdAt).toBeInstanceOf(Date);
    expect(inserted!.updatedAt).toBeInstanceOf(Date);
  });
});

// ─── 4. Insert a contract_option linked to a contract ───────────────

describe("Contract Options", () => {
  it("should insert a contract option linked to a contract", async () => {
    const [contract] = await db.insert(contracts).values(sampleContractValues()).returning();

    const [option] = await db
      .insert(contractOptions)
      .values({
        contractId: contract!.id,
        optionNumber: 1,
        optionStart: "2026-01-01",
        optionEnd: "2026-12-31",
        optionValue: "1500000.00",
        exerciseDeadline: "2025-10-01",
        status: "NOT_EXERCISED",
      })
      .returning();

    expect(option).toBeDefined();
    expect(option!.contractId).toBe(contract!.id);
    expect(option!.optionNumber).toBe(1);
    expect(option!.optionValue).toBe("1500000.00");
    expect(option!.status).toBe("NOT_EXERCISED");
  });
});

// ─── 5. Insert a modification linked to a contract ──────────────────

describe("Modifications", () => {
  it("should insert a modification linked to a contract", async () => {
    const [contract] = await db.insert(contracts).values(sampleContractValues()).returning();

    const [mod] = await db
      .insert(modifications)
      .values({
        contractId: contract!.id,
        modNumber: "P00001",
        modType: "FUNDING",
        effectiveDate: "2024-06-01",
        description: "Incremental funding action",
        ceilingDelta: "0.00",
        fundingDelta: "500000.00",
        status: "EXECUTED",
        sf30Reference: "SF30-2024-001",
      })
      .returning();

    expect(mod).toBeDefined();
    expect(mod!.contractId).toBe(contract!.id);
    expect(mod!.modNumber).toBe("P00001");
    expect(mod!.modType).toBe("FUNDING");
    expect(mod!.fundingDelta).toBe("500000.00");
    expect(mod!.sf30Reference).toBe("SF30-2024-001");
  });
});

// ─── 6. Insert a CLIN linked to a contract ──────────────────────────

describe("CLINs", () => {
  it("should insert a CLIN linked to a contract", async () => {
    const [contract] = await db.insert(contracts).values(sampleContractValues()).returning();

    const [clin] = await db
      .insert(clins)
      .values({
        contractId: contract!.id,
        clinNumber: "0001",
        description: "Software Development Services",
        quantity: 12,
        unitPrice: "150000.00",
        totalValue: "1800000.00",
        clinType: "T_AND_M",
        fundedAmount: "900000.00",
      })
      .returning();

    expect(clin).toBeDefined();
    expect(clin!.contractId).toBe(contract!.id);
    expect(clin!.clinNumber).toBe("0001");
    expect(clin!.clinType).toBe("T_AND_M");
    expect(clin!.totalValue).toBe("1800000.00");
  });
});

// ─── 7. Insert a deliverable linked to a CLIN ──────────────────────

describe("Deliverables", () => {
  it("should insert a deliverable linked to a contract and CLIN", async () => {
    const [contract] = await db.insert(contracts).values(sampleContractValues()).returning();

    const [clin] = await db
      .insert(clins)
      .values({
        contractId: contract!.id,
        clinNumber: "0001",
        description: "Development",
        totalValue: "1000000.00",
        clinType: "FFP",
        fundedAmount: "500000.00",
      })
      .returning();

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        contractId: contract!.id,
        clinId: clin!.id,
        deliverableType: "CDRL",
        description: "Monthly Status Report (CDRL A001)",
        dueDate: "2024-02-15",
        frequency: "MONTHLY",
        recipient: "contracting_officer",
        status: "NOT_STARTED",
      })
      .returning();

    expect(deliverable).toBeDefined();
    expect(deliverable!.contractId).toBe(contract!.id);
    expect(deliverable!.clinId).toBe(clin!.id);
    expect(deliverable!.deliverableType).toBe("CDRL");
    expect(deliverable!.frequency).toBe("MONTHLY");
    expect(deliverable!.status).toBe("NOT_STARTED");
  });
});

// ─── 8. Insert contract_clauses (FAR and DFARS) ────────────────────

describe("Contract Clauses", () => {
  it("should insert both FAR and DFARS clauses on a contract", async () => {
    const [contract] = await db.insert(contracts).values(sampleContractValues()).returning();

    const insertedClauses = await db
      .insert(contractClauses)
      .values([
        {
          contractId: contract!.id,
          clauseNumber: "52.212-4",
          clauseTitle: "Contract Terms and Conditions—Commercial Products and Commercial Services",
          clauseType: "FAR",
          riskCategory: "LOW",
          flowdownRequired: true,
        },
        {
          contractId: contract!.id,
          clauseNumber: "252.204-7012",
          clauseTitle: "Safeguarding Covered Defense Information and Cyber Incident Reporting",
          clauseVersion: "DEC 2019",
          clauseType: "DFARS",
          riskCategory: "CRITICAL",
          flowdownRequired: true,
          isDeviation: false,
        },
      ])
      .returning();

    expect(insertedClauses).toHaveLength(2);

    const farClause = insertedClauses.find((c) => c.clauseType === "FAR");
    const dfarsClause = insertedClauses.find((c) => c.clauseType === "DFARS");

    expect(farClause).toBeDefined();
    expect(farClause!.clauseNumber).toBe("52.212-4");
    expect(farClause!.riskCategory).toBe("LOW");
    expect(farClause!.flowdownRequired).toBe(true);

    expect(dfarsClause).toBeDefined();
    expect(dfarsClause!.clauseNumber).toBe("252.204-7012");
    expect(dfarsClause!.riskCategory).toBe("CRITICAL");
    expect(dfarsClause!.clauseVersion).toBe("DEC 2019");
  });
});

// ─── 9. Cascade behavior: deleting a contract ──────────────────────

describe("Cascade behavior", () => {
  it("should cascade-delete related records when a contract is deleted", async () => {
    const [contract] = await db.insert(contracts).values(sampleContractValues()).returning();
    const contractId = contract!.id;

    // Insert related records
    await db.insert(contractOptions).values({
      contractId,
      optionNumber: 1,
      optionStart: "2026-01-01",
      optionEnd: "2026-12-31",
      optionValue: "1000000.00",
      exerciseDeadline: "2025-10-01",
    });

    await db.insert(modifications).values({
      contractId,
      modNumber: "P00001",
      modType: "ADMIN",
      effectiveDate: "2024-03-01",
    });

    const [clin] = await db
      .insert(clins)
      .values({
        contractId,
        clinNumber: "0001",
        totalValue: "500000.00",
        clinType: "FFP",
        fundedAmount: "250000.00",
      })
      .returning();

    await db.insert(deliverables).values({
      contractId,
      clinId: clin!.id,
      deliverableType: "REPORT",
      recipient: "COR",
    });

    await db.insert(subcontracts).values({
      primeContractId: contractId,
      subcontractorName: "SubCo Inc",
      subType: "T_AND_M",
      ceilingValue: "200000.00",
      fundedValue: "100000.00",
      popStart: "2024-01-01",
      popEnd: "2025-12-31",
    });

    await db.insert(contractClauses).values({
      contractId,
      clauseNumber: "52.212-4",
      clauseTitle: "Contract Terms",
      clauseType: "FAR",
    });

    await db.insert(complianceMilestones).values({
      contractId,
      milestoneType: "ANNUAL_REVIEW",
      dueDate: "2024-12-31",
      responsibleParty: "PM",
    });

    await db.insert(governmentProperty).values({
      contractId,
      propertyType: "GFE",
      description: "Test equipment",
      location: "Building A",
      custodian: "John Doe",
    });

    await db.insert(smallBusinessPlans).values({
      contractId,
      planType: "INDIVIDUAL",
      goalPercentage: "23.00",
      reportingPeriod: "FY2024",
    });

    // Delete the contract
    await db.delete(contracts).where(eq(contracts.id, contractId));

    // Verify all related records were cascade-deleted
    const remainingOptions = await db.select().from(contractOptions).where(eq(contractOptions.contractId, contractId));
    expect(remainingOptions).toHaveLength(0);

    const remainingMods = await db.select().from(modifications).where(eq(modifications.contractId, contractId));
    expect(remainingMods).toHaveLength(0);

    const remainingClins = await db.select().from(clins).where(eq(clins.contractId, contractId));
    expect(remainingClins).toHaveLength(0);

    const remainingDeliverables = await db.select().from(deliverables).where(eq(deliverables.contractId, contractId));
    expect(remainingDeliverables).toHaveLength(0);

    const remainingSubcontracts = await db.select().from(subcontracts).where(eq(subcontracts.primeContractId, contractId));
    expect(remainingSubcontracts).toHaveLength(0);

    const remainingClauses = await db.select().from(contractClauses).where(eq(contractClauses.contractId, contractId));
    expect(remainingClauses).toHaveLength(0);

    const remainingMilestones = await db.select().from(complianceMilestones).where(eq(complianceMilestones.contractId, contractId));
    expect(remainingMilestones).toHaveLength(0);

    const remainingProperty = await db.select().from(governmentProperty).where(eq(governmentProperty.contractId, contractId));
    expect(remainingProperty).toHaveLength(0);

    const remainingPlans = await db.select().from(smallBusinessPlans).where(eq(smallBusinessPlans.contractId, contractId));
    expect(remainingPlans).toHaveLength(0);
  });
});

// ─── 10. Unique constraint on contract_number ───────────────────────

describe("Unique constraints", () => {
  it("should reject duplicate contract_number", async () => {
    await db.insert(contracts).values(sampleContractValues());

    await expect(
      db.insert(contracts).values(sampleContractValues({ contractNumber: "FA8721-24-C-0001" })),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  // ─── 11. Unique constraint on clause_library.clause_number ────────

  it("should reject duplicate clause_library.clause_number", async () => {
    await db.insert(clauseLibrary).values({
      clauseNumber: "52.212-4",
      title: "Contract Terms and Conditions",
      fullText: "Full clause text here...",
      lastUpdated: "2024-01-01",
    });

    await expect(
      db.insert(clauseLibrary).values({
        clauseNumber: "52.212-4",
        title: "Duplicate attempt",
        fullText: "Should fail",
        lastUpdated: "2024-01-01",
      }),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

// ─── 12. Contract request → approval queue linkage ──────────────────

describe("Contract Requests and Approval Queue", () => {
  it("should insert a contract_request and link it to an approval_queue entry", async () => {
    const [request] = await db
      .insert(contractRequests)
      .values({
        requestType: "NEW_CONTRACT",
        requesterName: "Alice Johnson",
        requesterEmail: "alice.johnson@example.com",
        priority: "HIGH",
        jiraTicketId: "FORGE-1234",
        detailsJson: { contractType: "FFP", estimatedValue: 5_000_000 },
        status: "PENDING_REVIEW",
      })
      .returning();

    expect(request).toBeDefined();
    expect(request!.requestType).toBe("NEW_CONTRACT");
    expect(request!.priority).toBe("HIGH");

    const [approval] = await db
      .insert(approvalQueue)
      .values({
        requestId: request!.id,
        approverEmail: "manager@example.com",
        approvalType: "CONTRACT_INITIATION",
        status: "PENDING",
        submittedAt: new Date(),
      })
      .returning();

    expect(approval).toBeDefined();
    expect(approval!.requestId).toBe(request!.id);
    expect(approval!.status).toBe("PENDING");
    expect(approval!.approverEmail).toBe("manager@example.com");

    // Verify the FK link works via query
    const queueItems = await db
      .select()
      .from(approvalQueue)
      .where(eq(approvalQueue.requestId, request!.id));

    expect(queueItems).toHaveLength(1);
    expect(queueItems[0]!.approvalType).toBe("CONTRACT_INITIATION");
  });
});

// ─── 13. Junction table: mou_parties ────────────────────────────────

describe("MOU Parties junction table", () => {
  it("should correctly link parties to an MOU with roles", async () => {
    // Create two parties
    const [partyA] = await db
      .insert(parties)
      .values({
        name: "Department of Defense",
        cageCode: "DOD01",
        businessSize: "LARGE",
      })
      .returning();

    const [partyB] = await db
      .insert(parties)
      .values({
        name: "Acme Federal Solutions",
        cageCode: "ACM01",
        dunsUei: "XYZ9876543210",
        businessSize: "SMALL",
      })
      .returning();

    // Create MOU
    const [mou] = await db
      .insert(mous)
      .values({
        effectiveDate: "2024-06-01",
        expirationDate: "2026-06-01",
        purpose: "Joint cybersecurity research initiative",
        obligationsSummary: "Both parties will share threat intelligence data",
        status: "ACTIVE",
      })
      .returning();

    // Link parties via junction table
    await db.insert(mouParties).values([
      { mouId: mou!.id, partyId: partyA!.id, role: "SPONSOR" },
      { mouId: mou!.id, partyId: partyB!.id, role: "PERFORMER" },
    ]);

    // Query junction table
    const links = await db
      .select()
      .from(mouParties)
      .where(eq(mouParties.mouId, mou!.id));

    expect(links).toHaveLength(2);

    const sponsorLink = links.find((l) => l.role === "SPONSOR");
    const performerLink = links.find((l) => l.role === "PERFORMER");

    expect(sponsorLink).toBeDefined();
    expect(sponsorLink!.partyId).toBe(partyA!.id);

    expect(performerLink).toBeDefined();
    expect(performerLink!.partyId).toBe(partyB!.id);

    // Verify composite primary key prevents duplicate (mou_id, party_id) pairs
    await expect(
      db.insert(mouParties).values({
        mouId: mou!.id,
        partyId: partyA!.id,
        role: "DIFFERENT_ROLE",
      }),
    ).rejects.toThrow(/unique|duplicate|violates/i);
  });
});
