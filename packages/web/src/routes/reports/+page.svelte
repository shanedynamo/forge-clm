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

<div class="page-enter" data-testid="reports-page">
  <h2 class="mb-4 font-heading font-semibold text-lg text-slate-900">Reports</h2>

  <!-- Report Type Selector -->
  <div class="mb-4 flex flex-wrap gap-2" data-testid="report-type-selector">
    {#each REPORT_TYPES as rt}
      <button
        class="rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-150
          {selectedType === rt.type
          ? 'border-coral bg-coral-50 text-coral-700'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}"
        on:click={() => selectType(rt.type)}
        data-testid="report-type-option"
        data-report-type={rt.type}
      >
        {rt.label}
      </button>
    {/each}
  </div>

  <!-- Description -->
  <p class="mb-4 font-body text-sm text-slate-700" data-testid="report-description">
    {selectedMeta.description}
  </p>

  <!-- Date Range + Actions -->
  <div
    class="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
  >
    <div>
      <label for="start-date" class="block font-body text-xs font-medium text-slate-700"
        >Start Date</label
      >
      <input
        id="start-date"
        type="date"
        bind:value={startDate}
        class="mt-1 rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
        data-testid="start-date"
      />
    </div>
    <div>
      <label for="end-date" class="block font-body text-xs font-medium text-slate-700"
        >End Date</label
      >
      <input
        id="end-date"
        type="date"
        bind:value={endDate}
        class="mt-1 rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
        data-testid="end-date"
      />
    </div>

    <!-- Extra fields based on report type -->
    {#if selectedMeta.extraFields.includes("agency")}
      <div data-testid="field-agency">
        <label
          for="agency-filter"
          class="block font-body text-xs font-medium text-slate-700">Agency</label
        >
        <select
          id="agency-filter"
          class="mt-1 rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
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
          class="block font-body text-xs font-medium text-slate-700">Team Member</label
        >
        <input
          id="team-filter"
          type="text"
          placeholder="All team members"
          class="mt-1 rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
        />
      </div>
    {/if}
    {#if selectedMeta.extraFields.includes("threshold")}
      <div data-testid="field-threshold">
        <label
          for="threshold-input"
          class="block font-body text-xs font-medium text-slate-700"
          >Alert Threshold (%)</label
        >
        <input
          id="threshold-input"
          type="number"
          value="80"
          min="0"
          max="100"
          class="mt-1 w-24 rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
        />
      </div>
    {/if}

    <div class="flex gap-2">
      <button
        class="rounded-lg bg-coral px-4 py-2 text-sm font-body font-medium text-white hover:brightness-110 transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
        on:click={generateReport}
        disabled={loading}
        data-testid="generate-btn"
      >
        {loading ? "Generating..." : "Generate Report"}
      </button>
      <button
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 font-body transition-all duration-150 disabled:opacity-50"
        on:click={exportCsv}
        disabled={!report}
        data-testid="export-csv"
      >
        Export CSV
      </button>
      <button
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 font-body transition-all duration-150 disabled:opacity-50"
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
      <div class="h-24 dynamo-skeleton"></div>
      <div class="h-64 dynamo-skeleton"></div>
      <div class="h-48 dynamo-skeleton"></div>
    </div>
  {/if}

  <!-- Report Results -->
  {#if report && !loading}
    <div data-testid="report-results">
      <!-- Summary Cards -->
      <div class="mb-6 grid grid-cols-4 gap-4">
        {#each Object.entries(report.summary) as [key, value]}
          <div
            class="rounded-lg border border-slate-300 bg-white p-4 shadow-sm hover:shadow-md transition-shadow duration-200"
            data-testid="summary-card"
          >
            <div class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide">
              {formatSummaryKey(key)}
            </div>
            <div class="mt-1 font-dramatic text-2xl font-bold text-slate-900">
              {typeof value === "number" ? value.toLocaleString() : value}
            </div>
          </div>
        {/each}
      </div>

      <!-- Chart -->
      <div
        class="mb-6 rounded-lg border border-slate-300 bg-white p-5 shadow-sm"
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
          class="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
        >
          <table class="dynamo-table w-full text-left text-sm" data-testid="report-table">
            <thead class="border-b border-slate-200 bg-slate-100">
              <tr>
                {#each Object.keys(report.rows[0]) as col}
                  <th
                    class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
                  >
                    {formatSummaryKey(col)}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
              {#each report.rows as row}
                <tr data-testid="report-row">
                  {#each Object.values(row) as val}
                    <td class="px-3 py-2.5 font-body text-slate-700">
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
