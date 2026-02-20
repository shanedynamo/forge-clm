/**
 * Lightweight mock API server for E2E tests.
 *
 * Returns realistic test data for all endpoints the SvelteKit
 * server-side load functions and client-side fetches call.
 */

import http from "node:http";

const PORT = parseInt(process.env["MOCK_PORT"] ?? "3000");

// ─── Mock data ──────────────────────────────────────────────────────

const CONTRACT_ID = "c0000001-0000-0000-0000-000000000001";
const CONTRACT_ID_2 = "c0000002-0000-0000-0000-000000000002";
const CONTRACT_ID_3 = "c0000003-0000-0000-0000-000000000003";
const REQUEST_ID = "r0000001-0000-0000-0000-000000000001";

const CONTRACTS = [
  {
    id: CONTRACT_ID,
    contractNumber: "FA8726-24-C-0042",
    contractType: "FFP",
    awardingAgency: "USAF",
    contractingOfficerName: "Maj. Jane Smith",
    contractingOfficerEmail: "jane.smith@usaf.mil",
    popStart: "2025-01-01",
    popEnd: "2026-12-31",
    ceilingValue: "2500000.00",
    fundedValue: "1800000.00",
    status: "ACTIVE",
    naicsCode: "541330",
    pscCode: "R425",
    securityLevel: "CUI",
    description: "Engineering support for avionics systems",
  },
  {
    id: CONTRACT_ID_2,
    contractNumber: "N00024-23-C-5500",
    contractType: "CPFF",
    awardingAgency: "USN",
    contractingOfficerName: "LCDR Adams",
    contractingOfficerEmail: "adams@navy.mil",
    popStart: "2024-06-01",
    popEnd: "2026-05-31",
    ceilingValue: "5000000.00",
    fundedValue: "3200000.00",
    status: "ACTIVE",
    description: "Naval weapons systems R&D",
  },
  {
    id: CONTRACT_ID_3,
    contractNumber: "W912HZ-25-C-0001",
    contractType: "T_AND_M",
    awardingAgency: "USA",
    contractingOfficerName: "Col. Rodriguez",
    contractingOfficerEmail: "rodriguez@army.mil",
    popStart: "2025-03-01",
    popEnd: "2027-02-28",
    ceilingValue: "1200000.00",
    fundedValue: "900000.00",
    status: "AWARDED",
    description: "IT infrastructure modernization",
  },
];

const CLAUSES = [
  { id: "cl-1", clauseNumber: "52.204-21", clauseTitle: "Basic Safeguarding of CUI", clauseType: "FAR", riskCategory: "HIGH", isDeviation: false, flowdownRequired: true },
  { id: "cl-2", clauseNumber: "52.215-1", clauseTitle: "Instructions to Offerors", clauseType: "FAR", riskCategory: "LOW", isDeviation: false, flowdownRequired: false },
  { id: "cl-3", clauseNumber: "252.204-7012", clauseTitle: "Safeguarding CDI", clauseType: "DFARS", riskCategory: "CRITICAL", isDeviation: false, flowdownRequired: true },
  { id: "cl-4", clauseNumber: "252.227-7013", clauseTitle: "Rights in Technical Data", clauseType: "DFARS", riskCategory: "HIGH", isDeviation: true, flowdownRequired: true },
];

const MODIFICATIONS = [
  { id: "mod-1", modNumber: "P00001", modType: "FUNDING", effectiveDate: "2025-06-15", description: "Incremental funding increase", ceilingDelta: "0.00", fundingDelta: "500000.00", status: "EXECUTED", createdAt: "2025-06-15T10:00:00Z" },
  { id: "mod-2", modNumber: "P00002", modType: "SCOPE", effectiveDate: "2025-09-01", description: "Add Task Order 3 for cybersecurity assessment", ceilingDelta: "300000.00", fundingDelta: "150000.00", status: "MOD_IDENTIFIED", createdAt: "2025-09-01T14:00:00Z" },
];

const DELIVERABLES = [
  { id: "del-1", deliverableType: "Monthly Report", description: "Monthly status report", dueDate: "2026-02-28", frequency: "MONTHLY", recipient: "COR", status: "NOT_STARTED" },
  { id: "del-2", deliverableType: "CDRL A001", description: "Technical data package", dueDate: "2026-06-30", frequency: "ONE_TIME", recipient: "CO", status: "IN_PROGRESS" },
];

const COMPLIANCE_ITEMS = [
  { id: "cm-1", milestoneName: "DCAA Audit", milestoneType: "DCAA_AUDIT", description: "Annual incurred cost audit", dueDate: "2026-02-16", responsibleParty: "Finance Team", status: "OVERDUE", contractId: CONTRACT_ID, contractNumber: "FA8726-24-C-0042" },
  { id: "cm-2", milestoneName: "CPARS Review", milestoneType: "CPARS_REVIEW", description: "Annual performance assessment", dueDate: "2026-02-25", responsibleParty: "PM", status: "PENDING", contractId: CONTRACT_ID, contractNumber: "FA8726-24-C-0042" },
];

const OPTIONS = [
  { id: "opt-1", optionNumber: 1, optionStart: "2026-07-01", optionEnd: "2027-06-30", optionValue: "1500000.00", exerciseDeadline: "2026-03-16", status: "NOT_EXERCISED" },
];

const TRANSITIONS = [
  { to: "CLOSEOUT", label: "Begin Closeout", requiredRole: "contracts_manager" },
  { to: "OPTION_EXERCISED", label: "Exercise Option", requiredRole: "contracts_manager" },
];

const METRICS = {
  activeContracts: 12,
  totalCeiling: 45000000,
  totalFunded: 32000000,
  pendingActions: 7,
};

const ACTIVITY = [
  { id: "act-1", agentType: "contract_ingestion", status: "SUCCESS", taskId: "task-001", createdAt: "2026-02-19T10:00:00Z" },
  { id: "act-2", agentType: "compliance_monitor", status: "FAILURE", taskId: "task-002", createdAt: "2026-02-18T09:00:00Z" },
  { id: "act-3", agentType: "intake_classifier", status: "SUCCESS", taskId: "task-003", createdAt: "2026-02-17T14:00:00Z" },
  { id: "act-4", agentType: "document_generation", status: "RUNNING", taskId: "task-004", createdAt: "2026-02-16T16:00:00Z" },
];

const OVERDUE_ITEMS = [
  {
    id: "ov-1",
    contractId: CONTRACT_ID,
    contractNumber: "FA8726-24-C-0042",
    itemType: "MILESTONE",
    description: "DCAA Audit - Annual incurred cost audit",
    dueDate: "2026-02-16",
    daysOverdue: 3,
    responsibleParty: "Finance Team",
    status: "OVERDUE",
  },
];

const FUNDING_STATUS = [
  { contractId: CONTRACT_ID, contractNumber: "FA8726-24-C-0042", ceilingValue: 2500000, fundedValue: 1800000, percentFunded: 72 },
  { contractId: CONTRACT_ID_2, contractNumber: "N00024-23-C-5500", ceilingValue: 5000000, fundedValue: 3200000, percentFunded: 64 },
  { contractId: CONTRACT_ID_3, contractNumber: "W912HZ-25-C-0001", ceilingValue: 1200000, fundedValue: 1050000, percentFunded: 87.5 },
];

const OPTION_WINDOWS = [
  { contractId: CONTRACT_ID, contractNumber: "FA8726-24-C-0042", optionNumber: 1, exerciseDeadline: "2026-03-16", daysRemaining: 25, optionValue: 1500000, status: "NOT_EXERCISED" },
];

const CALENDAR_DEADLINES = [
  { date: "2026-02-16", type: "MILESTONE", description: "DCAA Audit", contractNumber: "FA8726-24-C-0042", status: "OVERDUE" },
  { date: "2026-02-28", type: "DELIVERABLE", description: "Monthly Report", contractNumber: "FA8726-24-C-0042", status: "PENDING" },
  { date: "2026-03-01", type: "MILESTONE", description: "CPARS Review", contractNumber: "FA8726-24-C-0042", status: "PENDING" },
  { date: "2026-03-16", type: "OPTION", description: "Option 1 Exercise Deadline", contractNumber: "FA8726-24-C-0042", status: "PENDING" },
];

const SEARCH_RESULTS = [
  {
    id: "chunk-1",
    chunkText: "The Contractor shall protect all intellectual property rights including patents, copyrights, and trade secrets developed under this contract. All technical data and computer software shall be delivered with unlimited rights...",
    similarity: 0.94,
    contractId: CONTRACT_ID,
    contractNumber: "FA8726-24-C-0042",
    sectionType: "CLAUSE",
    clauseNumber: "252.227-7013",
  },
  {
    id: "chunk-2",
    chunkText: "Rights in technical data and computer software are governed by DFARS 252.227-7013 and 252.227-7014. The Government shall have unlimited rights in all data first produced in the performance of this contract...",
    similarity: 0.89,
    contractId: CONTRACT_ID,
    contractNumber: "FA8726-24-C-0042",
    sectionType: "SOW",
    clauseNumber: null,
  },
  {
    id: "chunk-3",
    chunkText: "Intellectual property developed prior to the contract period shall remain the property of the Contractor. Government purpose rights apply to data developed with mixed funding...",
    similarity: 0.82,
    contractId: CONTRACT_ID_2,
    contractNumber: "N00024-23-C-5500",
    sectionType: "CLAUSE",
    clauseNumber: "252.227-7014",
  },
];

const ASK_RESPONSE = {
  answer: "Based on the contract documents, the IP rights are governed by DFARS 252.227-7013. The Government has unlimited rights to all technical data and computer software first produced under the contract. Pre-existing IP remains with the contractor, and mixed-funding data is subject to government purpose rights for a 5-year period.",
  confidence: 0.91,
  citations: [
    {
      chunkId: "chunk-1",
      chunkText: "The Contractor shall protect all intellectual property rights including patents, copyrights, and trade secrets developed under this contract.",
      contractId: CONTRACT_ID,
      contractNumber: "FA8726-24-C-0042",
      sectionType: "CLAUSE",
      clauseNumber: "252.227-7013",
      relevance: 0.94,
    },
    {
      chunkId: "chunk-2",
      chunkText: "Rights in technical data and computer software are governed by DFARS 252.227-7013 and 252.227-7014.",
      contractId: CONTRACT_ID,
      contractNumber: "FA8726-24-C-0042",
      sectionType: "SOW",
      clauseNumber: null,
      relevance: 0.89,
    },
  ],
};

const REQUESTS: any[] = [
  {
    id: REQUEST_ID,
    requestType: "NDA",
    title: "NDA with Raytheon for Project Phoenix",
    summary: "Mutual NDA needed for classified program discussion",
    requester: "developer",
    assignedTo: null,
    priority: "HIGH",
    status: "NEW",
    submittedAt: "2026-02-19T10:00:00Z",
    metadata: { counterparty: "Raytheon", ndaType: "mutual", scope: "Project Phoenix classified discussions" },
  },
];

// Track new requests for the workflow test
let requestCounter = 0;

// ─── Router ─────────────────────────────────────────────────────────

function matchRoute(method: string, url: string): { handler: string; params: Record<string, string> } {
  const path = url.split("?")[0]!;

  // Static routes first
  const staticKey = `${method} ${path}`;
  if (ROUTES[staticKey]) return { handler: staticKey, params: {} };

  // Parameterized routes
  const segments = path.split("/");
  for (const pattern of Object.keys(ROUTES)) {
    const [pMethod, ...pPath] = pattern.split(" ");
    if (pMethod !== method) continue;
    const patternSegments = pPath.join(" ").split("/");
    if (patternSegments.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < segments.length; i++) {
      if (patternSegments[i]!.startsWith(":")) {
        params[patternSegments[i]!.slice(1)] = segments[i]!;
      } else if (patternSegments[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match) return { handler: pattern, params };
  }

  return { handler: "", params: {} };
}

type RouteHandler = (params: Record<string, string>, query: URLSearchParams, body?: any) => any;

const ROUTES: Record<string, RouteHandler> = {
  // Dashboard
  "GET /api/v1/dashboard/metrics": () => METRICS,

  // Activity
  "GET /api/v1/activity/recent": () => ACTIVITY,

  // Compliance
  "GET /api/v1/compliance/upcoming": () => COMPLIANCE_ITEMS.filter((c) => c.status !== "OVERDUE"),
  "GET /api/v1/compliance/overdue": () => COMPLIANCE_ITEMS.filter((c) => c.status === "OVERDUE"),
  "GET /api/v1/compliance/overdue/detailed": () => OVERDUE_ITEMS,
  "GET /api/v1/compliance/funding-status": () => FUNDING_STATUS,
  "GET /api/v1/compliance/option-windows": () => OPTION_WINDOWS,
  "GET /api/v1/compliance/calendar": () => CALENDAR_DEADLINES,

  // Contracts list
  "GET /api/v1/contracts": (_params, query) => {
    const filter = query.get("filter") ?? "";
    let filtered = [...CONTRACTS];
    if (filter.includes("status:ACTIVE")) {
      filtered = filtered.filter((c) => c.status === "ACTIVE");
    }
    return {
      data: filtered,
      pagination: { page: 1, limit: 20, total: filtered.length, totalPages: 1 },
    };
  },

  // Contract detail
  "GET /api/v1/contracts/:id": (params) => {
    return CONTRACTS.find((c) => c.id === params.id) ?? CONTRACTS[0];
  },
  "GET /api/v1/contracts/:id/clauses": () => CLAUSES,
  "GET /api/v1/contracts/:id/mods": () => MODIFICATIONS,
  "GET /api/v1/contracts/:id/deliverables": () => DELIVERABLES,
  "GET /api/v1/contracts/:id/compliance": () => COMPLIANCE_ITEMS,
  "GET /api/v1/contracts/:id/options": () => OPTIONS,
  "GET /api/v1/contracts/:id/communications": () => [],
  "GET /api/v1/contracts/:id/transitions": () => TRANSITIONS,
  "GET /api/v1/contracts/:id/history": () => [
    { id: "h-1", fromState: "AWARDED", toState: "ACTIVE", userId: "system", role: "system", timestamp: "2025-01-15T10:00:00Z" },
  ],

  // Transition
  "POST /api/v1/contracts/:id/transition": (params, _query, body) => {
    const contract = CONTRACTS.find((c) => c.id === params.id) ?? CONTRACTS[0]!;
    const newStatus = body?.toState ?? "CLOSEOUT";
    return { ...contract, status: newStatus };
  },

  // Search (client-side fetches)
  "POST /api/v1/search": () => SEARCH_RESULTS,
  "POST /api/v1/ask": () => ASK_RESPONSE,
  "POST /api/v1/search/ask": () => ASK_RESPONSE,

  // Requests
  "GET /api/v1/requests": () => REQUESTS,
  "POST /api/v1/requests": (_params, _query, body) => {
    requestCounter++;
    const newReq = {
      id: `r-new-${requestCounter}`,
      requestType: body?.requestType ?? "NDA",
      title: body?.title ?? "New Request",
      summary: body?.summary ?? "",
      requester: "developer",
      assignedTo: null,
      priority: body?.priority ?? "NORMAL",
      status: "NEW",
      submittedAt: new Date().toISOString(),
      metadata: body?.metadata ?? {},
    };
    REQUESTS.push(newReq);
    return newReq;
  },
  "GET /api/v1/requests/:id": (params) => {
    const req = REQUESTS.find((r: any) => r.id === params.id);
    if (req) return req;
    return { ...REQUESTS[REQUESTS.length - 1], status: "IN_PROGRESS" };
  },

  // Health
  "GET /health": () => ({ status: "ok", service: "forge-api-mock" }),
};

// ─── Server ─────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  const query = new URLSearchParams(url.split("?")[1] ?? "");

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse body for POST/PATCH
  let body: any = null;
  if (method === "POST" || method === "PATCH") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString();
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = null; }
    }
  }

  const { handler, params } = matchRoute(method, url);
  const routeHandler = ROUTES[handler];

  if (routeHandler) {
    const data = routeHandler(params, query, body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  } else {
    console.log(`[mock-api] 404: ${method} ${url}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path: url }));
  }
});

server.listen(PORT, () => {
  console.log(`Mock API running on http://localhost:${PORT}`);
});
