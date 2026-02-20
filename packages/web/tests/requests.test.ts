import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import RequestsPage from "../src/routes/requests/+page.svelte";
import type { ContractRequest } from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

const MOCK_REQUESTS: ContractRequest[] = [
  {
    id: "req-1",
    requestType: "NDA",
    title: "NDA with Raytheon",
    summary: "Mutual NDA for classified subcontract discussions",
    priority: "HIGH",
    status: "NEW",
    requester: "John Smith",
    assignedTo: null,
    submittedAt: "2026-02-18T10:00:00Z",
    metadata: { counterparty: "Raytheon", ndaType: "mutual" },
  },
  {
    id: "req-2",
    requestType: "MOD",
    title: "Funding Mod P00003",
    summary: "Incremental funding for FY26 Q1",
    priority: "URGENT",
    status: "IN_PROGRESS",
    requester: "Jane Doe",
    assignedTo: "Alice Johnson",
    submittedAt: "2026-02-15T08:30:00Z",
    metadata: { contractNumber: "FA8726-24-C-0042", modType: "FUNDING" },
  },
  {
    id: "req-3",
    requestType: "NEW_CONTRACT",
    title: "USAF Logistics Support",
    summary: "New contract proposal for logistics support services",
    priority: "NORMAL",
    status: "UNDER_REVIEW",
    requester: "Bob Wilson",
    assignedTo: "Jane Doe",
    submittedAt: "2026-02-10T14:00:00Z",
    metadata: {},
  },
  {
    id: "req-4",
    requestType: "OPTION_EXERCISE",
    title: "Exercise Option Year 2",
    summary: "Exercise option year 2 on N00024-23-C-5500",
    priority: "HIGH",
    status: "COMPLETED",
    requester: "Alice Johnson",
    assignedTo: "John Smith",
    submittedAt: "2026-01-20T09:00:00Z",
    metadata: { contractNumber: "N00024-23-C-5500", optionNumber: "2" },
  },
  {
    id: "req-5",
    requestType: "FUNDING_ACTION",
    title: "De-obligation Request",
    summary: "De-obligate excess funds from CLIN 0003",
    priority: "LOW",
    status: "NEW",
    requester: "John Smith",
    assignedTo: null,
    submittedAt: "2026-02-19T11:00:00Z",
    metadata: {},
  },
];

function makeData(requests = MOCK_REQUESTS) {
  return { data: { requests: [...requests] } };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Request queue — Kanban board", () => {
  it("renders board with correct columns", () => {
    render(RequestsPage, { props: makeData() });

    const board = screen.getByTestId("kanban-board");
    expect(board).toBeInTheDocument();

    const columns = screen.getAllByTestId("kanban-column");
    expect(columns.length).toBe(5);

    const statuses = columns.map((c) => c.getAttribute("data-status"));
    expect(statuses).toEqual([
      "NEW",
      "IN_PROGRESS",
      "UNDER_REVIEW",
      "COMPLETED",
      "CANCELLED",
    ]);

    // Check column counts
    const counts = screen.getAllByTestId("column-count");
    expect(counts[0]!.textContent).toBe("2"); // NEW: req-1, req-5
    expect(counts[1]!.textContent).toBe("1"); // IN_PROGRESS: req-2
    expect(counts[2]!.textContent).toBe("1"); // UNDER_REVIEW: req-3
    expect(counts[3]!.textContent).toBe("1"); // COMPLETED: req-4
    expect(counts[4]!.textContent).toBe("0"); // CANCELLED: none
  });

  it("displays request information on cards", () => {
    render(RequestsPage, { props: makeData() });

    const cards = screen.getAllByTestId("request-card");
    expect(cards.length).toBe(5);

    // Check first card (NDA with Raytheon)
    const ndaCard = cards.find(
      (c) => c.getAttribute("data-request-id") === "req-1",
    )!;
    expect(ndaCard.textContent).toContain("NDA with Raytheon");
    expect(ndaCard.textContent).toContain("Mutual NDA");
    expect(ndaCard.textContent).toContain("John Smith");

    // Priority badge
    const badges = screen.getAllByTestId("priority-badge");
    const highBadge = badges.find((b) => b.textContent?.trim() === "HIGH");
    expect(highBadge).toBeTruthy();
    expect(highBadge!.className).toContain("bg-orange");

    const urgentBadge = badges.find((b) => b.textContent?.trim() === "URGENT");
    expect(urgentBadge).toBeTruthy();
    expect(urgentBadge!.className).toContain("bg-red");
  });

  it("moves card on drag and drop", async () => {
    render(RequestsPage, { props: makeData() });

    // req-1 starts in NEW column
    const countsBefore = screen.getAllByTestId("column-count");
    expect(countsBefore[0]!.textContent).toBe("2"); // NEW
    expect(countsBefore[1]!.textContent).toBe("1"); // IN_PROGRESS

    // Find req-1 card and drag to IN_PROGRESS column
    const card = screen
      .getAllByTestId("request-card")
      .find((c) => c.getAttribute("data-request-id") === "req-1")!;
    const inProgressCol = screen
      .getAllByTestId("kanban-column")
      .find((c) => c.getAttribute("data-status") === "IN_PROGRESS")!;

    await fireEvent.dragStart(card);
    await fireEvent.drop(inProgressCol);

    // Counts should update
    const countsAfter = screen.getAllByTestId("column-count");
    expect(countsAfter[0]!.textContent).toBe("1"); // NEW (req-5 only)
    expect(countsAfter[1]!.textContent).toBe("2"); // IN_PROGRESS (req-2 + req-1)
  });

  it("filters cards by type", async () => {
    render(RequestsPage, { props: makeData() });

    // Initially 5 cards
    expect(screen.getAllByTestId("request-card").length).toBe(5);

    // Filter by NDA
    const typeFilter = screen.getByTestId("filter-type");
    await fireEvent.change(typeFilter, { target: { value: "NDA" } });

    const filtered = screen.getAllByTestId("request-card");
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.textContent).toContain("NDA with Raytheon");
  });
});

describe("Request queue — New request form", () => {
  it("renders dynamic fields based on request type", async () => {
    render(RequestsPage, { props: makeData() });

    // Open modal
    await fireEvent.click(screen.getByTestId("new-request-btn"));
    expect(screen.getByTestId("request-modal")).toBeInTheDocument();

    // Default type is NDA — should show NDA fields
    expect(screen.getByTestId("nda-fields")).toBeInTheDocument();
    expect(screen.getByTestId("field-counterparty")).toBeInTheDocument();
    expect(screen.getByTestId("field-nda-type")).toBeInTheDocument();

    // Switch to MOD
    const typeSelect = screen.getByTestId("form-type");
    await fireEvent.change(typeSelect, { target: { value: "MOD" } });
    expect(screen.getByTestId("mod-fields")).toBeInTheDocument();
    expect(screen.getByTestId("field-contract-number")).toBeInTheDocument();
    expect(screen.getByTestId("field-mod-type")).toBeInTheDocument();

    // Switch to FUNDING_ACTION
    await fireEvent.change(typeSelect, { target: { value: "FUNDING_ACTION" } });
    expect(screen.getByTestId("funding-fields")).toBeInTheDocument();
    expect(screen.getByTestId("field-clin")).toBeInTheDocument();
    expect(screen.getByTestId("field-amount")).toBeInTheDocument();
    expect(screen.getByTestId("field-justification")).toBeInTheDocument();
  });

  it("submits new request and adds card to board", async () => {
    render(RequestsPage, { props: makeData() });

    // Open modal
    await fireEvent.click(screen.getByTestId("new-request-btn"));

    // Fill form
    await fireEvent.input(screen.getByTestId("form-title"), {
      target: { value: "Test NDA Request" },
    });
    await fireEvent.input(screen.getByTestId("form-summary"), {
      target: { value: "Test summary" },
    });
    await fireEvent.change(screen.getByTestId("form-priority"), {
      target: { value: "HIGH" },
    });
    await fireEvent.input(screen.getByTestId("field-counterparty"), {
      target: { value: "Lockheed Martin" },
    });

    // Submit
    await fireEvent.submit(screen.getByTestId("request-form"));

    // Modal should close
    expect(screen.queryByTestId("request-modal")).toBeNull();

    // New card should appear in NEW column
    const cards = screen.getAllByTestId("request-card");
    expect(cards.length).toBe(6);

    // NEW column count should be 3
    const counts = screen.getAllByTestId("column-count");
    expect(counts[0]!.textContent).toBe("3");
  });
});
