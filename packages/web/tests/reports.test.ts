import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ReportsPage from "../src/routes/reports/+page.svelte";
import type { ReportResult } from "../src/lib/types.js";

// ─── Test data ────────────────────────────────────────────────────────

const MOCK_REPORT: ReportResult = {
  type: "CONTRACT_STATUS",
  generatedAt: "2026-02-19T10:00:00Z",
  startDate: "2026-01-01",
  endDate: "2026-02-19",
  summary: {
    totalContracts: 24,
    activeContracts: 18,
    totalCeiling: 45000000,
    avgCompletion: 67,
  },
  rows: [
    {
      contractNumber: "FA8726-24-C-0042",
      status: "ACTIVE",
      ceiling: 2500000,
      funded: 1800000,
    },
    {
      contractNumber: "N00024-23-C-5500",
      status: "OPTION_PENDING",
      ceiling: 5000000,
      funded: 3200000,
    },
    {
      contractNumber: "W912HZ-25-C-0001",
      status: "ACTIVE",
      ceiling: 1200000,
      funded: 900000,
    },
  ],
  chartData: [
    {
      label: "By Status",
      data: [18, 3, 2, 1],
      labels: ["Active", "Pending", "Closeout", "Closed"],
    },
  ],
};

function makeData() {
  return { data: {} };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Reports Page", () => {
  it("renders report type selector with all 6 types", () => {
    render(ReportsPage, { props: makeData() });

    const types = screen.getAllByTestId("report-type-option");
    expect(types.length).toBe(6);

    expect(types[0]!.textContent?.trim()).toBe("Contract Status Summary");
    expect(types[1]!.textContent?.trim()).toBe("Compliance Scorecard");
    expect(types[2]!.textContent?.trim()).toBe("Workload Analysis");
    expect(types[3]!.textContent?.trim()).toBe("SLA Tracking");
    expect(types[4]!.textContent?.trim()).toBe("Funding Overview");
    expect(types[5]!.textContent?.trim()).toBe("Agent Performance");

    // Default description shown
    expect(screen.getByTestId("report-description").textContent).toContain(
      "Overview of all contracts",
    );
  });

  it("changes form fields based on selected report type", async () => {
    render(ReportsPage, { props: makeData() });

    // Default: CONTRACT_STATUS — no extra fields
    expect(screen.queryByTestId("field-agency")).toBeNull();
    expect(screen.queryByTestId("field-team")).toBeNull();
    expect(screen.queryByTestId("field-threshold")).toBeNull();

    const types = screen.getAllByTestId("report-type-option");

    // Select COMPLIANCE_SCORECARD — shows agency filter
    await fireEvent.click(types[1]!);
    expect(screen.getByTestId("field-agency")).toBeInTheDocument();
    expect(screen.getByTestId("report-description").textContent).toContain(
      "Compliance rates",
    );

    // Select WORKLOAD_ANALYSIS — shows team filter
    await fireEvent.click(types[2]!);
    expect(screen.getByTestId("field-team")).toBeInTheDocument();
    expect(screen.queryByTestId("field-agency")).toBeNull();

    // Select FUNDING_OVERVIEW — shows threshold field
    await fireEvent.click(types[4]!);
    expect(screen.getByTestId("field-threshold")).toBeInTheDocument();
    expect(screen.queryByTestId("field-team")).toBeNull();
  });

  it("shows loading state while generating report", () => {
    render(ReportsPage, {
      props: { ...makeData(), initialLoading: true },
    });

    expect(screen.getByTestId("report-loading")).toBeInTheDocument();

    // Report results should NOT be visible during loading
    expect(screen.queryByTestId("report-results")).toBeNull();
  });

  it("displays chart and table after report generation", () => {
    render(ReportsPage, {
      props: { ...makeData(), initialReport: MOCK_REPORT },
    });

    // Summary cards
    const summaryCards = screen.getAllByTestId("summary-card");
    expect(summaryCards.length).toBe(4);
    expect(summaryCards[0]!.textContent).toContain("24");
    expect(summaryCards[1]!.textContent).toContain("18");

    // Chart canvas
    expect(screen.getByTestId("report-chart")).toBeInTheDocument();

    // Data table
    const tableRows = screen.getAllByTestId("report-row");
    expect(tableRows.length).toBe(3);
    expect(tableRows[0]!.textContent).toContain("FA8726-24-C-0042");
    expect(tableRows[1]!.textContent).toContain("N00024-23-C-5500");
  });

  it("export buttons are disabled without report and enabled with report", () => {
    // Without report — buttons disabled
    const { unmount } = render(ReportsPage, { props: makeData() });
    expect(screen.getByTestId("export-csv")).toBeDisabled();
    expect(screen.getByTestId("export-docx")).toBeDisabled();
    unmount();

    // With report — buttons enabled
    render(ReportsPage, {
      props: { ...makeData(), initialReport: MOCK_REPORT },
    });
    expect(screen.getByTestId("export-csv")).not.toBeDisabled();
    expect(screen.getByTestId("export-docx")).not.toBeDisabled();
  });
});
