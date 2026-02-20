import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import CompliancePage from "../src/routes/compliance/+page.svelte";
import type {
  ComplianceItem,
  OverdueItem,
  FundingStatus,
  OptionWindow,
  CalendarDeadline,
} from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

// "Now" in tests is 2026-02-19 (the system date)

const MOCK_DUE_THIS_WEEK: ComplianceItem[] = [
  {
    id: "cw-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    milestoneName: "Monthly Status Report",
    dueDate: "2026-02-20",
    status: "PENDING",
  },
  {
    id: "cw-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    milestoneName: "Deliverable Review",
    dueDate: "2026-02-22",
    status: "PENDING",
  },
  {
    id: "cw-3",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    milestoneName: "Cost Report",
    dueDate: "2026-02-25",
    status: "PENDING",
  },
];

const MOCK_OVERDUE: OverdueItem[] = [
  {
    id: "od-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    itemType: "Deliverable",
    description: "Quarterly Technical Report Q4",
    dueDate: "2026-02-01",
    daysOverdue: 18,
    responsibleParty: "John Smith",
    status: "OVERDUE",
  },
  {
    id: "od-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    itemType: "Compliance",
    description: "Annual Security Assessment",
    dueDate: "2026-02-10",
    daysOverdue: 9,
    responsibleParty: "Jane Doe",
    status: "OVERDUE",
  },
  {
    id: "od-3",
    contractId: "c-3",
    contractNumber: "W91CRB-25-D-0001",
    itemType: "Deliverable",
    description: "Monthly Status Report January",
    dueDate: "2026-01-31",
    daysOverdue: 19,
    responsibleParty: "Alice Johnson",
    status: "OVERDUE",
  },
];

const MOCK_UPCOMING: ComplianceItem[] = [
  // This week (within 7 days from 2026-02-19)
  {
    id: "up-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    milestoneName: "Status Report",
    dueDate: "2026-02-20",
    status: "PENDING",
  },
  // Next week
  {
    id: "up-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    milestoneName: "Cost Report",
    dueDate: "2026-02-28",
    status: "PENDING",
  },
  // In 2 weeks
  {
    id: "up-3",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    milestoneName: "Deliverable Submission",
    dueDate: "2026-03-05",
    status: "PENDING",
  },
  // In 3-4 weeks
  {
    id: "up-4",
    contractId: "c-3",
    contractNumber: "W91CRB-25-D-0001",
    milestoneName: "Quarterly Review",
    dueDate: "2026-03-15",
    status: "PENDING",
  },
];

const MOCK_OPTION_WINDOWS: OptionWindow[] = [
  {
    id: "ow-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    optionNumber: 2,
    exerciseDeadline: "2026-03-15",
    optionValue: "1300000",
    status: "PENDING",
  },
  {
    id: "ow-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    optionNumber: 1,
    exerciseDeadline: "2026-04-30",
    optionValue: "2500000",
    status: "PENDING",
  },
];

const MOCK_FUNDING: FundingStatus[] = [
  {
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    ceilingValue: "5000000",
    fundedValue: "4600000",
    percentFunded: 92,
    projectedRunout: "2026-05-15",
    status: "ACTIVE",
  },
  {
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    ceilingValue: "12000000",
    fundedValue: "10200000",
    percentFunded: 85,
    projectedRunout: "2026-08-01",
    status: "ACTIVE",
  },
  {
    contractId: "c-3",
    contractNumber: "W91CRB-25-D-0001",
    ceilingValue: "50000000",
    fundedValue: "25000000",
    percentFunded: 50,
    projectedRunout: null,
    status: "ACTIVE",
  },
];

const MOCK_CALENDAR: CalendarDeadline[] = [
  {
    id: "cal-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    date: "2026-02-20",
    title: "Monthly Status Report",
    type: "deliverable",
  },
  {
    id: "cal-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    date: "2026-02-20",
    title: "Security Review",
    type: "compliance",
  },
  {
    id: "cal-3",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    date: "2026-02-25",
    title: "Option Exercise Deadline",
    type: "option",
  },
  {
    id: "cal-4",
    contractId: "c-3",
    contractNumber: "W91CRB-25-D-0001",
    date: "2026-02-28",
    title: "Funding Alert",
    type: "funding",
  },
];

function makePageData() {
  return {
    data: {
      dueThisWeek: MOCK_DUE_THIS_WEEK,
      overdueItems: MOCK_OVERDUE,
      upcoming: MOCK_UPCOMING,
      optionWindows: MOCK_OPTION_WINDOWS,
      fundingStatus: MOCK_FUNDING,
      calendarDeadlines: MOCK_CALENDAR,
      calendarYear: 2026,
      calendarMonth: 2,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Compliance dashboard — Summary cards", () => {
  it("shows correct counts in all four summary cards", () => {
    render(CompliancePage, { props: makePageData() });

    const dueCard = screen.getByTestId("card-due-this-week");
    expect(dueCard.textContent).toContain("3");
    expect(dueCard.textContent).toContain("Due This Week");

    const overdueCard = screen.getByTestId("card-overdue");
    expect(overdueCard.textContent).toContain("3");
    expect(overdueCard.textContent).toContain("Overdue");

    const optionCard = screen.getByTestId("card-option-windows");
    expect(optionCard.textContent).toContain("2");
    expect(optionCard.textContent).toContain("Option Windows");

    // 2 contracts > 80%: c-1 (92%) and c-2 (85%)
    const ceilingCard = screen.getByTestId("card-ceiling-alerts");
    expect(ceilingCard.textContent).toContain("2");
    expect(ceilingCard.textContent).toContain("Approaching Ceiling");
  });
});

describe("Compliance dashboard — Calendar", () => {
  it("renders calendar grid with deadline markers", () => {
    render(CompliancePage, { props: makePageData() });

    const grid = screen.getByTestId("calendar-grid");
    expect(grid).toBeInTheDocument();

    // Should contain day-of-week headers
    expect(grid.textContent).toContain("Sun");
    expect(grid.textContent).toContain("Mon");
    expect(grid.textContent).toContain("Sat");

    // Check that deadline markers exist
    const markers = screen.getAllByTestId("deadline-marker");
    // 4 deadlines, Feb 20 has 2 items = 2 markers, Feb 25 has 1, Feb 28 has 1 = 4 total
    expect(markers.length).toBe(4);
  });

  it("shows detail panel when clicking a calendar date", async () => {
    render(CompliancePage, { props: makePageData() });

    // Find the Feb 20 cell (has 2 deadlines)
    const allDays = screen.getAllByTestId("calendar-day");
    const feb20 = allDays.find((el) => el.getAttribute("data-date") === "2026-02-20");
    expect(feb20).toBeTruthy();

    await fireEvent.click(feb20!);

    const detail = screen.getByTestId("calendar-detail");
    expect(detail).toBeInTheDocument();

    const detailItems = screen.getAllByTestId("calendar-detail-item");
    expect(detailItems.length).toBe(2);
    expect(detail.textContent).toContain("Monthly Status Report");
    expect(detail.textContent).toContain("Security Review");
    expect(detail.textContent).toContain("FA8726-24-C-0042");
    expect(detail.textContent).toContain("N00024-23-C-5500");
  });
});

describe("Compliance dashboard — Overdue table", () => {
  it("sorts overdue items by clicking column headers", async () => {
    render(CompliancePage, { props: makePageData() });

    const rows = screen.getAllByTestId("overdue-row");
    expect(rows.length).toBe(3);

    // Default sort: daysOverdue descending — od-3 (19d), od-1 (18d), od-2 (9d)
    const daysOverdueValues = screen.getAllByTestId("days-overdue");
    expect(daysOverdueValues[0]!.textContent).toContain("19d");
    expect(daysOverdueValues[1]!.textContent).toContain("18d");
    expect(daysOverdueValues[2]!.textContent).toContain("9d");

    // Click contractNumber header to sort by contract number
    const sortBtn = screen.getByTestId("sort-contractNumber");
    await fireEvent.click(sortBtn);

    // Should now be sorted by contractNumber descending
    const rowsAfter = screen.getAllByTestId("overdue-row");
    // W91... > N00... > FA8... descending
    expect(rowsAfter[0]!.textContent).toContain("W91CRB");
    expect(rowsAfter[1]!.textContent).toContain("N00024");
    expect(rowsAfter[2]!.textContent).toContain("FA8726");
  });

  it("shows Jira ticket creation action button", async () => {
    render(CompliancePage, { props: makePageData() });

    const jiraBtns = screen.getAllByTestId("jira-btn");
    expect(jiraBtns.length).toBe(3);
    expect(jiraBtns[0]!.textContent).toContain("Create Ticket");

    // Click to create ticket
    await fireEvent.click(jiraBtns[0]!);
    expect(jiraBtns[0]!.textContent).toContain("Ticket Created");
  });
});

describe("Compliance dashboard — Upcoming deadlines", () => {
  it("groups upcoming items by week", () => {
    render(CompliancePage, { props: makePageData() });

    const weekGroups = screen.getAllByTestId("week-group");
    // Should have groups: This Week, Next Week, In 2 Weeks, In 3-4 Weeks
    expect(weekGroups.length).toBeGreaterThanOrEqual(2);

    const labels = screen.getAllByTestId("week-label");
    const labelTexts = labels.map((l) => l.textContent);
    expect(labelTexts.some((t) => t?.includes("This Week"))).toBe(true);

    const items = screen.getAllByTestId("upcoming-item");
    expect(items.length).toBe(4);
  });
});

describe("Compliance dashboard — Funding status", () => {
  it("shows percentage bars sorted by most critical first", () => {
    render(CompliancePage, { props: makePageData() });

    const rows = screen.getAllByTestId("funding-row");
    expect(rows.length).toBe(3);

    // Sorted by percentFunded descending: 92%, 85%, 50%
    const percents = screen.getAllByTestId("funding-percent");
    expect(percents[0]!.textContent).toContain("92%");
    expect(percents[1]!.textContent).toContain("85%");
    expect(percents[2]!.textContent).toContain("50%");

    // Check funding bars exist
    const bars = screen.getAllByTestId("funding-bar");
    expect(bars.length).toBe(3);

    // 92% should be red, 85% orange, 50% green
    expect(bars[0]!.className).toContain("bg-red");
    expect(bars[1]!.className).toContain("bg-orange");
    expect(bars[2]!.className).toContain("bg-green");

    // Check contract numbers in order
    expect(rows[0]!.textContent).toContain("FA8726-24-C-0042");
    expect(rows[1]!.textContent).toContain("N00024-23-C-5500");
    expect(rows[2]!.textContent).toContain("W91CRB-25-D-0001");
  });
});

describe("Compliance dashboard — Option tracker", () => {
  it("shows countdown timers for option windows", () => {
    render(CompliancePage, { props: makePageData() });

    const optionRows = screen.getAllByTestId("option-tracker-row");
    expect(optionRows.length).toBe(2);

    expect(optionRows[0]!.textContent).toContain("FA8726-24-C-0042");
    expect(optionRows[0]!.textContent).toContain("Option 2");
    expect(optionRows[1]!.textContent).toContain("N00024-23-C-5500");
    expect(optionRows[1]!.textContent).toContain("Option 1");

    // Check countdown elements exist
    const countdowns = screen.getAllByTestId("option-countdown");
    expect(countdowns.length).toBe(2);

    // Both should show "remaining" since deadlines are in the future
    expect(countdowns[0]!.textContent).toContain("remaining");
    expect(countdowns[1]!.textContent).toContain("remaining");

    // Check values
    expect(optionRows[0]!.textContent).toContain("$1,300,000");
    expect(optionRows[1]!.textContent).toContain("$2,500,000");
  });
});
