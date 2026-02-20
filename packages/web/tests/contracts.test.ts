import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ContractListPage from "../src/routes/contracts/+page.svelte";
import ContractDetailPage from "../src/routes/contracts/[id]/+page.svelte";
import ClausesTab from "../src/components/contract/ClausesTab.svelte";
import ModificationsTab from "../src/components/contract/ModificationsTab.svelte";
import DeliverablesTab from "../src/components/contract/DeliverablesTab.svelte";
import CommunicationsTab from "../src/components/contract/CommunicationsTab.svelte";
import OptionsTab from "../src/components/contract/OptionsTab.svelte";
import StatusBadge from "../src/components/StatusBadge.svelte";
import {
  formatCurrency,
  formatDate,
  statusColor,
  statusLabel,
  riskColor,
} from "../src/lib/format.js";
import type {
  ContractSummary,
  ContractDetail,
  ContractClause,
  Modification,
  Deliverable,
  Communication,
  ContractOption,
  FsmTransition,
} from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

const MOCK_CONTRACTS: ContractSummary[] = [
  {
    id: "c-1",
    contractNumber: "FA8726-24-C-0042",
    status: "ACTIVE",
    contractType: "FFP",
    ceilingValue: "5000000",
    fundedValue: "3200000",
    awardingAgency: "USAF",
    popStart: "2024-01-15",
    popEnd: "2027-01-14",
  },
  {
    id: "c-2",
    contractNumber: "N00024-23-C-5500",
    status: "PROPOSAL_SUBMITTED",
    contractType: "CPFF",
    ceilingValue: "12000000",
    fundedValue: "0",
    awardingAgency: "USN",
    popStart: "2024-06-01",
    popEnd: "2028-05-31",
  },
  {
    id: "c-3",
    contractNumber: "W91CRB-25-D-0001",
    status: "CLOSED",
    contractType: "IDIQ",
    ceilingValue: "50000000",
    fundedValue: "48500000",
    awardingAgency: "USA",
    popStart: "2020-03-01",
    popEnd: "2025-02-28",
  },
];

const MOCK_DETAIL: ContractDetail = {
  id: "c-1",
  contractNumber: "FA8726-24-C-0042",
  status: "ACTIVE",
  contractType: "FFP",
  ceilingValue: "5000000",
  fundedValue: "3200000",
  awardingAgency: "USAF",
  popStart: "2024-01-15",
  popEnd: "2027-01-14",
  contractingOfficerName: "Jane Smith",
  contractingOfficerEmail: "jane.smith@usaf.mil",
  securityLevel: "UNCLASSIFIED",
  description: "Aircraft maintenance and logistics support",
  createdAt: "2024-01-10T08:00:00Z",
};

const MOCK_CLAUSES: ContractClause[] = [
  {
    id: "cl-1",
    clauseNumber: "52.219-8",
    clauseTitle: "Utilization of Small Business Concerns",
    clauseType: "FAR",
    fullText: "Full text of the clause...",
    riskCategory: "LOW",
    analysisNotes: "Standard small business clause",
  },
  {
    id: "cl-2",
    clauseNumber: "252.227-7013",
    clauseTitle: "Rights in Technical Data",
    clauseType: "DFARS",
    fullText: "Full text of data rights...",
    riskCategory: "HIGH",
    analysisNotes: "Restrict distribution — review before deliverable submission",
  },
  {
    id: "cl-3",
    clauseNumber: "52.232-22",
    clauseTitle: "Limitation of Funds",
    clauseType: "FAR",
    fullText: "Limitation of funds text...",
    riskCategory: null,
    analysisNotes: null,
  },
];

const MOCK_MODS: Modification[] = [
  {
    id: "m-1",
    modNumber: "P00001",
    modType: "ADMINISTRATIVE",
    status: "MOD_EXECUTED",
    effectiveDate: "2024-06-15",
    description: "Update CO name and address",
    ceilingDelta: "0",
    fundingDelta: "0",
  },
  {
    id: "m-2",
    modNumber: "P00002",
    modType: "FUNDING",
    status: "MOD_UNDER_REVIEW",
    effectiveDate: "2025-01-10",
    description: "Incremental funding — FY25 Q1",
    ceilingDelta: "0",
    fundingDelta: "800000",
  },
];

const MOCK_DELIVERABLES: Deliverable[] = [
  {
    id: "d-1",
    name: "Monthly Status Report",
    status: "SUBMITTED",
    dueDate: "2026-02-15",
    lastSubmitted: "2026-02-14",
    description: "January monthly status",
  },
  {
    id: "d-2",
    name: "Quarterly Technical Report",
    status: "PENDING",
    dueDate: "2025-12-01",
    lastSubmitted: null,
    description: "Q4 2025 technical report",
  },
  {
    id: "d-3",
    name: "Annual Security Review",
    status: "PENDING",
    dueDate: "2026-03-15",
    lastSubmitted: null,
    description: "Annual security assessment deliverable",
  },
];

const MOCK_COMMS: Communication[] = [
  {
    id: "comm-1",
    direction: "INBOUND",
    channel: "Email",
    subject: "Contract Status Inquiry",
    summary: "CO requested updated burn rate data",
    createdAt: "2026-02-18T14:30:00Z",
  },
  {
    id: "comm-2",
    direction: "OUTBOUND",
    channel: "Email",
    subject: "Burn Rate Response",
    summary: "Provided Q1 burn rate analysis",
    createdAt: "2026-02-18T16:00:00Z",
  },
];

const MOCK_OPTIONS: ContractOption[] = [
  {
    id: "opt-1",
    optionNumber: 1,
    optionStart: "2025-01-15",
    optionEnd: "2026-01-14",
    optionValue: "1200000",
    exerciseDeadline: "2024-10-15",
    status: "EXERCISED",
  },
  {
    id: "opt-2",
    optionNumber: 2,
    optionStart: "2026-01-15",
    optionEnd: "2027-01-14",
    optionValue: "1300000",
    exerciseDeadline: "2025-10-15",
    status: "PENDING",
  },
];

const MOCK_TRANSITIONS: FsmTransition[] = [
  { to: "OPTION_PENDING", requiredRole: "contracts_manager" },
  { to: "STOP_WORK", requiredRole: "contracts_manager" },
  { to: "CLOSEOUT_PENDING", requiredRole: "contracts_manager" },
];

// ─── Formatting utility tests ─────────────────────────────────────────

describe("Format utilities", () => {
  it("formatCurrency handles string and number inputs", () => {
    expect(formatCurrency(5000000)).toBe("$5,000,000");
    expect(formatCurrency("3200000")).toBe("$3,200,000");
    expect(formatCurrency("0")).toBe("$0");
    expect(formatCurrency("invalid")).toBe("$0");
  });

  it("statusLabel converts underscored statuses", () => {
    expect(statusLabel("PROPOSAL_SUBMITTED")).toBe("PROPOSAL SUBMITTED");
    expect(statusLabel("ACTIVE")).toBe("ACTIVE");
    expect(statusLabel("MOD_IN_PROGRESS")).toBe("MOD IN PROGRESS");
  });

  it("statusColor returns correct Tailwind classes", () => {
    expect(statusColor("ACTIVE")).toContain("bg-green");
    expect(statusColor("STOP_WORK")).toContain("bg-red");
    expect(statusColor("PENDING")).toContain("bg-amber");
    expect(statusColor("UNKNOWN_STATUS")).toContain("bg-gray");
  });

  it("riskColor maps risk categories", () => {
    expect(riskColor("LOW")).toContain("bg-green");
    expect(riskColor("HIGH")).toContain("bg-orange");
    expect(riskColor("CRITICAL")).toContain("bg-red");
    expect(riskColor(null)).toContain("bg-gray");
  });
});

// ─── Contract list tests ──────────────────────────────────────────────

describe("Contract list page", () => {
  const listData = {
    data: MOCK_CONTRACTS,
    pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
    search: "",
    status: "",
    contractType: "",
    agency: "",
    sort: "",
  };

  it("renders table with correct columns and contract rows", () => {
    render(ContractListPage, { props: { data: listData } });

    const table = screen.getByTestId("contracts-table");
    expect(table).toBeInTheDocument();

    // Check all 8 column headers
    expect(table.textContent).toContain("Contract #");
    expect(table.textContent).toContain("Status");
    expect(table.textContent).toContain("Type");
    expect(table.textContent).toContain("Ceiling Value");
    expect(table.textContent).toContain("Funded Value");
    expect(table.textContent).toContain("Agency");
    expect(table.textContent).toContain("PoP Start");
    expect(table.textContent).toContain("PoP End");

    // Check rows
    const rows = screen.getAllByTestId("contract-row");
    expect(rows.length).toBe(3);
    expect(rows[0]!.textContent).toContain("FA8726-24-C-0042");
    expect(rows[1]!.textContent).toContain("N00024-23-C-5500");
  });

  it("shows pagination controls when multiple pages exist", () => {
    const multiPageData = {
      ...listData,
      pagination: { page: 2, limit: 20, total: 55, totalPages: 3 },
    };

    render(ContractListPage, { props: { data: multiPageData } });

    const pagination = screen.getByTestId("pagination");
    expect(pagination).toBeInTheDocument();
    expect(pagination.textContent).toContain("Page 2 of 3");
    expect(screen.getByTestId("prev-page")).toBeInTheDocument();
    expect(screen.getByTestId("next-page")).toBeInTheDocument();
  });

  it("displays status badges with correct colors", () => {
    render(ContractListPage, { props: { data: listData } });

    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBe(3);

    // ACTIVE → green
    expect(badges[0]!.className).toContain("bg-green");
    expect(badges[0]!.textContent?.trim()).toBe("ACTIVE");

    // PROPOSAL_SUBMITTED → indigo
    expect(badges[1]!.className).toContain("bg-indigo");
    expect(badges[1]!.textContent?.trim()).toBe("PROPOSAL SUBMITTED");

    // CLOSED → gray
    expect(badges[2]!.className).toContain("bg-gray");
    expect(badges[2]!.textContent?.trim()).toBe("CLOSED");
  });

  it("renders filter sidebar with dropdowns", () => {
    render(ContractListPage, { props: { data: listData } });

    const sidebar = screen.getByTestId("filter-sidebar");
    expect(sidebar).toBeInTheDocument();
    expect(sidebar.textContent).toContain("Filters");
    expect(sidebar.textContent).toContain("Status");
    expect(sidebar.textContent).toContain("Contract Type");
    expect(sidebar.textContent).toContain("Agency");
  });

  it("renders search input", () => {
    render(ContractListPage, { props: { data: listData } });

    const searchInput = screen.getByTestId("search-input");
    expect(searchInput).toBeInTheDocument();
    expect(searchInput.getAttribute("placeholder")).toContain("Search by contract number");
  });
});

// ─── Contract detail tests ────────────────────────────────────────────

describe("Contract detail page", () => {
  const detailData = {
    contract: MOCK_DETAIL,
    clauses: MOCK_CLAUSES,
    modifications: MOCK_MODS,
    deliverables: MOCK_DELIVERABLES,
    compliance: [],
    options: MOCK_OPTIONS,
    communications: MOCK_COMMS,
    transitions: MOCK_TRANSITIONS,
  };

  it("renders overview tab with contract info", () => {
    render(ContractDetailPage, { props: { data: detailData } });

    expect(screen.getByTestId("contract-number").textContent).toContain("FA8726-24-C-0042");
    expect(screen.getByTestId("contract-status").textContent).toContain("ACTIVE");

    const overview = screen.getByTestId("overview-tab");
    expect(overview).toBeInTheDocument();
    expect(overview.textContent).toContain("Jane Smith");
    expect(overview.textContent).toContain("USAF");
    expect(overview.textContent).toContain("$5,000,000");
    expect(overview.textContent).toContain("$3,200,000");
  });

  it("shows all 8 tab labels", () => {
    render(ContractDetailPage, { props: { data: detailData } });

    const tabNav = screen.getByTestId("tab-nav");
    const tabs = ["Overview", "Clauses", "Modifications", "Deliverables", "Compliance", "Options", "Documents", "Communications"];
    for (const tab of tabs) {
      expect(tabNav.textContent).toContain(tab);
    }
  });
});

// ─── Tab component tests ──────────────────────────────────────────────

describe("Clauses tab", () => {
  it("displays clauses with risk badges", () => {
    render(ClausesTab, { props: { clauses: MOCK_CLAUSES } });

    const items = screen.getAllByTestId("clause-item");
    expect(items.length).toBe(3);
    expect(items[0]!.textContent).toContain("52.219-8");
    expect(items[0]!.textContent).toContain("Utilization of Small Business Concerns");

    const riskBadges = screen.getAllByTestId("risk-badge");
    expect(riskBadges.length).toBe(3);
    // LOW → green
    expect(riskBadges[0]!.className).toContain("bg-green");
    expect(riskBadges[0]!.textContent?.trim()).toBe("LOW");
    // HIGH → orange
    expect(riskBadges[1]!.className).toContain("bg-orange");
    expect(riskBadges[1]!.textContent?.trim()).toBe("HIGH");
  });
});

describe("Modifications tab", () => {
  it("shows timeline entries with status badges and deltas", () => {
    render(ModificationsTab, { props: { modifications: MOCK_MODS } });

    const items = screen.getAllByTestId("mod-item");
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toContain("P00001");
    expect(items[0]!.textContent).toContain("ADMINISTRATIVE");

    const statuses = screen.getAllByTestId("mod-status");
    expect(statuses[0]!.textContent?.trim()).toBe("MOD EXECUTED");
    expect(statuses[0]!.className).toContain("bg-green");
    expect(statuses[1]!.textContent?.trim()).toBe("MOD UNDER REVIEW");
    expect(statuses[1]!.className).toContain("bg-amber");

    // Funding delta
    expect(items[1]!.textContent).toContain("$800,000");
  });
});

describe("Deliverables tab", () => {
  it("highlights overdue items", () => {
    render(DeliverablesTab, { props: { deliverables: MOCK_DELIVERABLES } });

    const rows = screen.getAllByTestId("deliverable-row");
    expect(rows.length).toBe(3);

    // d-2 has dueDate 2025-12-01 which is in the past → overdue
    const overdueRow = rows[1]!;
    expect(overdueRow.getAttribute("data-overdue")).toBe("true");
    expect(overdueRow.textContent).toContain("Quarterly Technical Report");

    const overdueBadges = screen.getAllByTestId("overdue-badge");
    expect(overdueBadges.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Communications tab", () => {
  it("shows direction badges for inbound and outbound", () => {
    render(CommunicationsTab, { props: { communications: MOCK_COMMS } });

    const items = screen.getAllByTestId("comm-item");
    expect(items.length).toBe(2);

    const badges = screen.getAllByTestId("direction-badge");
    expect(badges.length).toBe(2);
    expect(badges[0]!.textContent).toContain("IN");
    expect(badges[0]!.className).toContain("bg-blue");
    expect(badges[1]!.textContent).toContain("OUT");
    expect(badges[1]!.className).toContain("bg-emerald");

    expect(items[0]!.textContent).toContain("Contract Status Inquiry");
    expect(items[1]!.textContent).toContain("Burn Rate Response");
  });
});
