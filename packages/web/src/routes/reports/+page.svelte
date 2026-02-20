<script lang="ts">
  import type { ReportType, ReportResult } from "$lib/types.js";

  // svelte-ignore export_let_unused
  export let data: Record<string, never>;

  // Testability props
  export let initialReport: ReportResult | null = null;
  export let initialLoading: boolean = false;
  export let initialSelectedType: ReportType = "CONTRACT_STATUS";

  interface ReportMeta {
    type: ReportType;
    label: string;
    description: string;
    extraFields: string[];
  }

  const REPORT_TYPES: ReportMeta[] = [
    {
      type: "CONTRACT_STATUS",
      label: "Contract Status Summary",
      description: "Overview of all contracts by status, type, and agency",
      extraFields: [],
    },
    {
      type: "COMPLIANCE_SCORECARD",
      label: "Compliance Scorecard",
      description: "Compliance rates, overdue items, and risk assessment",
      extraFields: ["agency"],
    },
    {
      type: "WORKLOAD_ANALYSIS",
      label: "Workload Analysis",
      description: "Team workload distribution and capacity planning",
      extraFields: ["team"],
    },
    {
      type: "SLA_TRACKING",
      label: "SLA Tracking",
      description: "Service level agreement adherence and response times",
      extraFields: [],
    },
    {
      type: "FUNDING_OVERVIEW",
      label: "Funding Overview",
      description: "Funding levels, burn rates, and projected runout",
      extraFields: ["threshold"],
    },
    {
      type: "AGENT_PERFORMANCE",
      label: "Agent Performance",
      description: "AI agent success rates, execution times, and throughput",
      extraFields: [],
    },
  ];

  let selectedType: ReportType = initialSelectedType;
  let startDate = "2026-01-01";
  let endDate = "2026-02-19";
  let loading = initialLoading;
  let report: ReportResult | null = initialReport;

  $: selectedMeta = REPORT_TYPES.find((r) => r.type === selectedType)!;

  function selectType(type: ReportType) {
    selectedType = type;
    report = null;
  }

  async function generateReport() {
    loading = true;
    report = null;
  }

  function exportCsv() {
    // Download handler — would call API and trigger blob download
  }

  function exportDocx() {
    // Download handler — would call API and trigger blob download
  }

  function formatSummaryKey(key: string): string {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }
</script>

<div data-testid="reports-page">
  <h2 class="mb-4 text-lg font-semibold text-navy-900">Reports</h2>

  <!-- Report Type Selector -->
  <div class="mb-4 flex flex-wrap gap-2" data-testid="report-type-selector">
    {#each REPORT_TYPES as rt}
      <button
        class="rounded-lg border px-4 py-2 text-sm font-medium transition-colors
          {selectedType === rt.type
          ? 'border-accent-500 bg-accent-50 text-accent-700'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}"
        on:click={() => selectType(rt.type)}
        data-testid="report-type-option"
        data-report-type={rt.type}
      >
        {rt.label}
      </button>
    {/each}
  </div>

  <!-- Description -->
  <p class="mb-4 text-sm text-gray-600" data-testid="report-description">
    {selectedMeta.description}
  </p>

  <!-- Date Range + Actions -->
  <div
    class="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
  >
    <div>
      <label for="start-date" class="block text-xs font-medium text-gray-600"
        >Start Date</label
      >
      <input
        id="start-date"
        type="date"
        bind:value={startDate}
        class="mt-1 rounded border-gray-300 text-sm"
        data-testid="start-date"
      />
    </div>
    <div>
      <label for="end-date" class="block text-xs font-medium text-gray-600"
        >End Date</label
      >
      <input
        id="end-date"
        type="date"
        bind:value={endDate}
        class="mt-1 rounded border-gray-300 text-sm"
        data-testid="end-date"
      />
    </div>

    <!-- Extra fields based on report type -->
    {#if selectedMeta.extraFields.includes("agency")}
      <div data-testid="field-agency">
        <label
          for="agency-filter"
          class="block text-xs font-medium text-gray-600">Agency</label
        >
        <select
          id="agency-filter"
          class="mt-1 rounded border-gray-300 text-sm"
        >
          <option value="">All Agencies</option>
          <option value="USAF">USAF</option>
          <option value="USN">USN</option>
          <option value="USA">USA</option>
          <option value="DARPA">DARPA</option>
        </select>
      </div>
    {/if}
    {#if selectedMeta.extraFields.includes("team")}
      <div data-testid="field-team">
        <label
          for="team-filter"
          class="block text-xs font-medium text-gray-600">Team Member</label
        >
        <input
          id="team-filter"
          type="text"
          placeholder="All team members"
          class="mt-1 rounded border-gray-300 text-sm"
        />
      </div>
    {/if}
    {#if selectedMeta.extraFields.includes("threshold")}
      <div data-testid="field-threshold">
        <label
          for="threshold-input"
          class="block text-xs font-medium text-gray-600"
          >Alert Threshold (%)</label
        >
        <input
          id="threshold-input"
          type="number"
          value="80"
          min="0"
          max="100"
          class="mt-1 w-24 rounded border-gray-300 text-sm"
        />
      </div>
    {/if}

    <div class="flex gap-2">
      <button
        class="rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700 disabled:opacity-50"
        on:click={generateReport}
        disabled={loading}
        data-testid="generate-btn"
      >
        {loading ? "Generating..." : "Generate Report"}
      </button>
      <button
        class="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        on:click={exportCsv}
        disabled={!report}
        data-testid="export-csv"
      >
        Export CSV
      </button>
      <button
        class="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        on:click={exportDocx}
        disabled={!report}
        data-testid="export-docx"
      >
        Export DOCX
      </button>
    </div>
  </div>

  <!-- Loading State -->
  {#if loading}
    <div class="space-y-4" data-testid="report-loading">
      <div class="h-24 animate-pulse rounded-lg bg-gray-200"></div>
      <div class="h-64 animate-pulse rounded-lg bg-gray-200"></div>
      <div class="h-48 animate-pulse rounded-lg bg-gray-200"></div>
    </div>
  {/if}

  <!-- Report Results -->
  {#if report && !loading}
    <div data-testid="report-results">
      <!-- Summary Cards -->
      <div class="mb-6 grid grid-cols-4 gap-4">
        {#each Object.entries(report.summary) as [key, value]}
          <div
            class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            data-testid="summary-card"
          >
            <div class="text-xs font-medium uppercase text-gray-500">
              {formatSummaryKey(key)}
            </div>
            <div class="mt-1 text-2xl font-bold text-navy-900">
              {typeof value === "number" ? value.toLocaleString() : value}
            </div>
          </div>
        {/each}
      </div>

      <!-- Chart -->
      <div
        class="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
      >
        <canvas
          data-testid="report-chart"
          width="600"
          height="300"
        ></canvas>
      </div>

      <!-- Data Table -->
      {#if report.rows.length > 0}
        <div
          class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
        >
          <table class="w-full text-left text-sm" data-testid="report-table">
            <thead class="border-b border-gray-200 bg-gray-50">
              <tr>
                {#each Object.keys(report.rows[0]) as col}
                  <th
                    class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
                  >
                    {formatSummaryKey(col)}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each report.rows as row}
                <tr data-testid="report-row">
                  {#each Object.values(row) as val}
                    <td class="px-3 py-2.5 text-gray-700">
                      {typeof val === "number" ? val.toLocaleString() : val}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
