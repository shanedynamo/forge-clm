import {
  pgTable,
  pgSchema,
  pgEnum,
  uuid,
  varchar,
  text,
  date,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Schema ──────────────────────────────────────────────────────────
export const contractsSchema = pgSchema("contracts");

// ─── Enums ───────────────────────────────────────────────────────────

export const contractTypeEnum = contractsSchema.enum("contract_type", [
  "FFP",
  "CPFF",
  "T_AND_M",
  "IDIQ",
  "BPA",
  "COST_PLUS",
  "HYBRID",
]);

export const securityLevelEnum = contractsSchema.enum("security_level", [
  "UNCLASSIFIED",
  "CUI",
  "SECRET",
  "TOP_SECRET",
]);

export const optionStatusEnum = contractsSchema.enum("option_status", [
  "NOT_EXERCISED",
  "PENDING",
  "EXERCISED",
  "EXPIRED",
]);

export const modTypeEnum = contractsSchema.enum("mod_type", [
  "ADMIN",
  "FUNDING",
  "SCOPE",
  "OPTION_EXERCISE",
  "TERMINATION",
  "NOVATION",
  "NAME_CHANGE",
]);

export const clinTypeEnum = contractsSchema.enum("clin_type", [
  "FFP",
  "CPFF",
  "T_AND_M",
  "COST_PLUS",
]);

export const frequencyEnum = contractsSchema.enum("frequency", [
  "ONE_TIME",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
  "AS_NEEDED",
]);

export const deliverableStatusEnum = contractsSchema.enum("deliverable_status", [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "OVERDUE",
]);

export const businessSizeEnum = contractsSchema.enum("business_size", [
  "LARGE",
  "SMALL",
  "EIGHT_A",
  "HUBZONE",
  "SDVOSB",
  "WOSB",
  "EDWOSB",
]);

export const ndaTypeEnum = contractsSchema.enum("nda_type", [
  "MUTUAL",
  "UNILATERAL",
]);

export const clauseTypeEnum = contractsSchema.enum("clause_type", [
  "FAR",
  "DFARS",
  "AGENCY_SUPPLEMENT",
]);

export const riskCategoryEnum = contractsSchema.enum("risk_category", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
  "UNASSESSED",
]);

export const flowdownStatusEnum = contractsSchema.enum("flowdown_status", [
  "REQUIRED",
  "APPLIED",
  "WAIVED",
]);

export const recurrenceEnum = contractsSchema.enum("recurrence", [
  "ONE_TIME",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
]);

export const milestoneStatusEnum = contractsSchema.enum("milestone_status", [
  "PENDING",
  "COMPLETED",
  "OVERDUE",
  "WAIVED",
]);

export const propertyTypeEnum = contractsSchema.enum("property_type", [
  "GFP",
  "GFE",
  "GFI",
]);

export const propertyStatusEnum = contractsSchema.enum("property_status", [
  "ACTIVE",
  "RETURNED",
  "LOST",
  "CONSUMED",
]);

export const sbPlanTypeEnum = contractsSchema.enum("sb_plan_type", [
  "INDIVIDUAL",
  "MASTER",
]);

export const sbPlanStatusEnum = contractsSchema.enum("sb_plan_status", [
  "ACTIVE",
  "SUBMITTED",
  "APPROVED",
  "CLOSED",
]);

export const requestTypeEnum = contractsSchema.enum("request_type", [
  "NDA",
  "MOU",
  "NEW_CONTRACT",
  "MOD",
  "OPTION_EXERCISE",
  "FUNDING_ACTION",
  "TASK_ASSIGNMENT",
  "SUB_MOD",
]);

export const priorityEnum = contractsSchema.enum("priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

export const approvalStatusEnum = contractsSchema.enum("approval_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const commDirectionEnum = contractsSchema.enum("comm_direction", [
  "INBOUND",
  "OUTBOUND",
]);

export const commChannelEnum = contractsSchema.enum("comm_channel", [
  "EMAIL",
  "TEAMS",
  "LETTER",
  "PHONE",
]);

// ─── 1. contracts ────────────────────────────────────────────────────

export const contracts = contractsSchema.table(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractNumber: varchar("contract_number", { length: 100 }).notNull().unique(),
    contractType: contractTypeEnum("contract_type").notNull(),
    awardingAgency: varchar("awarding_agency", { length: 500 }).notNull(),
    contractingOfficerName: varchar("contracting_officer_name", { length: 255 }).notNull(),
    contractingOfficerEmail: varchar("contracting_officer_email", { length: 255 }).notNull(),
    corName: varchar("cor_name", { length: 255 }),
    corEmail: varchar("cor_email", { length: 255 }),
    popStart: date("pop_start").notNull(),
    popEnd: date("pop_end").notNull(),
    ceilingValue: numeric("ceiling_value", { precision: 15, scale: 2 }).notNull(),
    fundedValue: numeric("funded_value", { precision: 15, scale: 2 }).notNull(),
    naicsCode: varchar("naics_code", { length: 6 }),
    pscCode: varchar("psc_code", { length: 4 }),
    securityLevel: securityLevelEnum("security_level").notNull().default("UNCLASSIFIED"),
    cageCode: varchar("cage_code", { length: 5 }),
    dunsUei: varchar("duns_uei", { length: 13 }),
    status: varchar("status", { length: 50 }).notNull().default("DRAFT"),
    description: text("description"),
    s3DocumentKey: varchar("s3_document_key", { length: 1000 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_contracts_contract_number").on(table.contractNumber),
    index("idx_contracts_status").on(table.status),
    index("idx_contracts_naics_code").on(table.naicsCode),
    index("idx_contracts_psc_code").on(table.pscCode),
  ],
);

// ─── 2. contract_options ─────────────────────────────────────────────

export const contractOptions = contractsSchema.table(
  "contract_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    optionNumber: integer("option_number").notNull(),
    optionStart: date("option_start").notNull(),
    optionEnd: date("option_end").notNull(),
    optionValue: numeric("option_value", { precision: 15, scale: 2 }).notNull(),
    exerciseDeadline: date("exercise_deadline").notNull(),
    status: optionStatusEnum("status").notNull().default("NOT_EXERCISED"),
    notificationSentAt: timestamp("notification_sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_contract_options_contract_id").on(table.contractId),
    index("idx_contract_options_exercise_deadline").on(table.exerciseDeadline),
    index("idx_contract_options_status").on(table.status),
  ],
);

// ─── 3. modifications ────────────────────────────────────────────────

export const modifications = contractsSchema.table(
  "modifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    modNumber: varchar("mod_number", { length: 50 }).notNull(),
    modType: modTypeEnum("mod_type").notNull(),
    effectiveDate: date("effective_date").notNull(),
    description: text("description"),
    ceilingDelta: numeric("ceiling_delta", { precision: 15, scale: 2 }),
    fundingDelta: numeric("funding_delta", { precision: 15, scale: 2 }),
    status: varchar("status", { length: 50 }).notNull().default("DRAFT"),
    sf30Reference: varchar("sf30_reference", { length: 100 }),
    s3DocumentKey: varchar("s3_document_key", { length: 1000 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_modifications_contract_id").on(table.contractId),
    index("idx_modifications_status").on(table.status),
  ],
);

// ─── 4. clins ────────────────────────────────────────────────────────

export const clins = contractsSchema.table(
  "clins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    clinNumber: varchar("clin_number", { length: 50 }).notNull(),
    description: text("description"),
    quantity: integer("quantity"),
    unitPrice: numeric("unit_price", { precision: 15, scale: 2 }),
    totalValue: numeric("total_value", { precision: 15, scale: 2 }).notNull(),
    clinType: clinTypeEnum("clin_type").notNull(),
    fundedAmount: numeric("funded_amount", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_clins_contract_id").on(table.contractId),
  ],
);

// ─── 5. deliverables ─────────────────────────────────────────────────

export const deliverables = contractsSchema.table(
  "deliverables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    clinId: uuid("clin_id").references(() => clins.id, { onDelete: "set null" }),
    deliverableType: varchar("deliverable_type", { length: 100 }).notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    frequency: frequencyEnum("frequency").notNull().default("ONE_TIME"),
    recipient: varchar("recipient", { length: 255 }).notNull(),
    status: deliverableStatusEnum("status").notNull().default("NOT_STARTED"),
    lastSubmittedAt: timestamp("last_submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_deliverables_contract_id").on(table.contractId),
    index("idx_deliverables_due_date").on(table.dueDate),
    index("idx_deliverables_status").on(table.status),
  ],
);

// ─── 6. subcontracts ─────────────────────────────────────────────────

export const subcontracts = contractsSchema.table(
  "subcontracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    primeContractId: uuid("prime_contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    subcontractorName: varchar("subcontractor_name", { length: 500 }).notNull(),
    subcontractorCage: varchar("subcontractor_cage", { length: 5 }),
    subType: varchar("sub_type", { length: 100 }).notNull(),
    ceilingValue: numeric("ceiling_value", { precision: 15, scale: 2 }).notNull(),
    fundedValue: numeric("funded_value", { precision: 15, scale: 2 }).notNull(),
    popStart: date("pop_start").notNull(),
    popEnd: date("pop_end").notNull(),
    status: varchar("status", { length: 50 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_subcontracts_prime_contract_id").on(table.primeContractId),
    index("idx_subcontracts_status").on(table.status),
  ],
);

// ─── 7. parties ──────────────────────────────────────────────────────

export const parties = contractsSchema.table(
  "parties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 500 }).notNull(),
    cageCode: varchar("cage_code", { length: 5 }),
    dunsUei: varchar("duns_uei", { length: 13 }),
    address: text("address"),
    businessSize: businessSizeEnum("business_size"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

// ─── 8. ndas ─────────────────────────────────────────────────────────

export const ndas = contractsSchema.table(
  "ndas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    partyAId: uuid("party_a_id")
      .notNull()
      .references(() => parties.id),
    partyBId: uuid("party_b_id")
      .notNull()
      .references(() => parties.id),
    effectiveDate: date("effective_date").notNull(),
    expirationDate: date("expiration_date").notNull(),
    ndaType: ndaTypeEnum("nda_type").notNull(),
    scopeDescription: text("scope_description"),
    status: varchar("status", { length: 50 }).notNull().default("DRAFT"),
    documentS3Key: varchar("document_s3_key", { length: 1000 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_ndas_status").on(table.status),
  ],
);

// ─── 9. mous ─────────────────────────────────────────────────────────

export const mous = contractsSchema.table(
  "mous",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    effectiveDate: date("effective_date").notNull(),
    expirationDate: date("expiration_date"),
    purpose: text("purpose").notNull(),
    obligationsSummary: text("obligations_summary"),
    status: varchar("status", { length: 50 }).notNull().default("DRAFT"),
    documentS3Key: varchar("document_s3_key", { length: 1000 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_mous_status").on(table.status),
  ],
);

// ─── 10. mou_parties (junction) ──────────────────────────────────────

export const mouParties = contractsSchema.table(
  "mou_parties",
  {
    mouId: uuid("mou_id")
      .notNull()
      .references(() => mous.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 100 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.mouId, table.partyId] }),
  ],
);

// ─── 11. contract_clauses ────────────────────────────────────────────

export const contractClauses = contractsSchema.table(
  "contract_clauses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    clauseNumber: varchar("clause_number", { length: 50 }).notNull(),
    clauseTitle: varchar("clause_title", { length: 500 }).notNull(),
    clauseVersion: varchar("clause_version", { length: 50 }),
    clauseType: clauseTypeEnum("clause_type").notNull(),
    isDeviation: boolean("is_deviation").notNull().default(false),
    flowdownRequired: boolean("flowdown_required").notNull().default(false),
    riskCategory: riskCategoryEnum("risk_category").notNull().default("UNASSESSED"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_contract_clauses_contract_id").on(table.contractId),
    index("idx_contract_clauses_clause_number").on(table.clauseNumber),
  ],
);

// ─── 12. clause_library ──────────────────────────────────────────────

export const clauseLibrary = contractsSchema.table(
  "clause_library",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clauseNumber: varchar("clause_number", { length: 50 }).notNull().unique(),
    title: varchar("title", { length: 500 }).notNull(),
    fullText: text("full_text").notNull(),
    prescription: text("prescription"),
    lastUpdated: date("last_updated").notNull(),
    flowdownApplicability: text("flowdown_applicability"),
    riskNotes: text("risk_notes"),
    source: varchar("source", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_clause_library_clause_number").on(table.clauseNumber),
  ],
);

// ─── 13. flowdown_requirements ───────────────────────────────────────

export const flowdownRequirements = contractsSchema.table(
  "flowdown_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    primeClauseId: uuid("prime_clause_id")
      .notNull()
      .references(() => contractClauses.id, { onDelete: "cascade" }),
    subContractId: uuid("sub_contract_id")
      .notNull()
      .references(() => subcontracts.id, { onDelete: "cascade" }),
    flowdownStatus: flowdownStatusEnum("flowdown_status").notNull().default("REQUIRED"),
    appliedDate: date("applied_date"),
    waiverJustification: text("waiver_justification"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

// ─── 14. compliance_milestones ───────────────────────────────────────

export const complianceMilestones = contractsSchema.table(
  "compliance_milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    milestoneType: varchar("milestone_type", { length: 100 }).notNull(),
    description: text("description"),
    dueDate: date("due_date").notNull(),
    recurrence: recurrenceEnum("recurrence").notNull().default("ONE_TIME"),
    responsibleParty: varchar("responsible_party", { length: 255 }).notNull(),
    status: milestoneStatusEnum("status").notNull().default("PENDING"),
    reminderSentAt: timestamp("reminder_sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_compliance_milestones_contract_id").on(table.contractId),
    index("idx_compliance_milestones_due_date").on(table.dueDate),
    index("idx_compliance_milestones_status").on(table.status),
  ],
);

// ─── 15. government_property ─────────────────────────────────────────

export const governmentProperty = contractsSchema.table(
  "government_property",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    propertyType: propertyTypeEnum("property_type").notNull(),
    description: text("description").notNull(),
    serialNumber: varchar("serial_number", { length: 100 }),
    acquisitionCost: numeric("acquisition_cost", { precision: 15, scale: 2 }),
    location: varchar("location", { length: 500 }).notNull(),
    custodian: varchar("custodian", { length: 255 }).notNull(),
    inventoryDueDate: date("inventory_due_date"),
    status: propertyStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_government_property_contract_id").on(table.contractId),
    index("idx_government_property_status").on(table.status),
  ],
);

// ─── 16. small_business_plans ────────────────────────────────────────

export const smallBusinessPlans = contractsSchema.table(
  "small_business_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    planType: sbPlanTypeEnum("plan_type").notNull(),
    goalPercentage: numeric("goal_percentage", { precision: 5, scale: 2 }).notNull(),
    actualPercentage: numeric("actual_percentage", { precision: 5, scale: 2 }),
    reportingPeriod: varchar("reporting_period", { length: 50 }).notNull(),
    status: sbPlanStatusEnum("status").notNull().default("ACTIVE"),
    lastReportDate: date("last_report_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_small_business_plans_contract_id").on(table.contractId),
    index("idx_small_business_plans_status").on(table.status),
  ],
);

// ─── 17. contract_requests ───────────────────────────────────────────

export const contractRequests = contractsSchema.table(
  "contract_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestType: requestTypeEnum("request_type").notNull(),
    requesterName: varchar("requester_name", { length: 255 }).notNull(),
    requesterEmail: varchar("requester_email", { length: 255 }).notNull(),
    priority: priorityEnum("priority").notNull().default("MEDIUM"),
    jiraTicketId: varchar("jira_ticket_id", { length: 100 }),
    detailsJson: jsonb("details_json"),
    status: varchar("status", { length: 50 }).notNull().default("OPEN"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_contract_requests_status").on(table.status),
  ],
);

// ─── 18. approval_queue ──────────────────────────────────────────────

export const approvalQueue = contractsSchema.table(
  "approval_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").references(() => contractRequests.id, { onDelete: "set null" }),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    modId: uuid("mod_id").references(() => modifications.id, { onDelete: "set null" }),
    approverEmail: varchar("approver_email", { length: 255 }).notNull(),
    approvalType: varchar("approval_type", { length: 100 }).notNull(),
    documentS3Key: varchar("document_s3_key", { length: 1000 }),
    status: approvalStatusEnum("status").notNull().default("PENDING"),
    submittedAt: timestamp("submitted_at").notNull(),
    decidedAt: timestamp("decided_at"),
    decisionNotes: text("decision_notes"),
  },
  (table) => [
    index("idx_approval_queue_status").on(table.status),
    index("idx_approval_queue_request_id").on(table.requestId),
    index("idx_approval_queue_contract_id").on(table.contractId),
  ],
);

// ─── 19. communications_log ──────────────────────────────────────────

export const communicationsLog = contractsSchema.table(
  "communications_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    modId: uuid("mod_id").references(() => modifications.id, { onDelete: "set null" }),
    direction: commDirectionEnum("direction").notNull(),
    channel: commChannelEnum("channel").notNull(),
    fromParty: varchar("from_party", { length: 255 }).notNull(),
    toParty: varchar("to_party", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    bodyPreview: text("body_preview"),
    s3Key: varchar("s3_key", { length: 1000 }),
    receivedAt: timestamp("received_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_communications_log_contract_id").on(table.contractId),
    index("idx_communications_log_mod_id").on(table.modId),
  ],
);
