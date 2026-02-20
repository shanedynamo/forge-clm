<script lang="ts">
  import type { ContractSummary, PaginatedResponse } from "$lib/types.js";
  import { formatCurrency, formatDate, statusColor, statusLabel } from "$lib/format.js";
  import { canWrite } from "$lib/auth.js";
  import type { AuthRole } from "$lib/types.js";

  export let data: PaginatedResponse<ContractSummary> & {
    search: string;
    status: string;
    contractType: string;
    agency: string;
    sort: string;
  };

  const contracts = data.data ?? [];
  const pagination = data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 };

  // Sort state
  let currentSort = data.sort ?? "";

  function sortUrl(column: string): string {
    const next = currentSort === column ? `-${column}` : currentSort === `-${column}` ? "" : column;
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    if (next) params.set("sort", next);
    else params.delete("sort");
    params.set("page", "1");
    return `?${params}`;
  }

  function sortIndicator(column: string): string {
    if (currentSort === column) return " \u25B2";
    if (currentSort === `-${column}`) return " \u25BC";
    return "";
  }

  function pageUrl(p: number): string {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    params.set("page", String(p));
    return `?${params}`;
  }

  const CONTRACT_TYPES = ["FFP", "CPFF", "CPIF", "CPAF", "T&M", "IDIQ", "BPA"];
  const STATUS_OPTIONS = [
    "OPPORTUNITY_IDENTIFIED", "PROPOSAL_IN_PROGRESS", "PROPOSAL_SUBMITTED",
    "AWARD_PENDING", "AWARDED", "ACTIVE", "OPTION_PENDING",
    "MOD_IN_PROGRESS", "STOP_WORK", "CLOSEOUT_PENDING", "CLOSED",
    "TERMINATED", "NOT_AWARDED",
  ];

  const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
    { key: "contractNumber", label: "Contract #", sortable: true },
    { key: "status", label: "Status", sortable: true },
    { key: "contractType", label: "Type", sortable: true },
    { key: "ceilingValue", label: "Ceiling Value", sortable: true },
    { key: "fundedValue", label: "Funded Value", sortable: true },
    { key: "awardingAgency", label: "Agency", sortable: true },
    { key: "popStart", label: "PoP Start", sortable: true },
    { key: "popEnd", label: "PoP End", sortable: true },
  ];
</script>

<div class="flex gap-6" data-testid="contracts-page">
  <!-- Filter Sidebar -->
  <aside class="hidden w-56 shrink-0 lg:block" data-testid="filter-sidebar">
    <form method="get" class="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 class="text-sm font-semibold text-gray-700">Filters</h3>

      <div>
        <label for="filter-status" class="block text-xs font-medium text-gray-600">Status</label>
        <select id="filter-status" name="status" class="mt-1 w-full rounded border-gray-300 text-sm" value={data.status}>
          <option value="">All</option>
          {#each STATUS_OPTIONS as s}
            <option value={s}>{statusLabel(s)}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="filter-type" class="block text-xs font-medium text-gray-600">Contract Type</label>
        <select id="filter-type" name="contractType" class="mt-1 w-full rounded border-gray-300 text-sm" value={data.contractType}>
          <option value="">All</option>
          {#each CONTRACT_TYPES as t}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="filter-agency" class="block text-xs font-medium text-gray-600">Agency</label>
        <input
          id="filter-agency"
          name="agency"
          type="text"
          placeholder="e.g. USAF"
          class="mt-1 w-full rounded border-gray-300 text-sm"
          value={data.agency}
        />
      </div>

      <button type="submit" class="w-full rounded bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-700">
        Apply Filters
      </button>
    </form>
  </aside>

  <!-- Main Content -->
  <div class="min-w-0 flex-1">
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold text-navy-900">Contracts</h2>
        <span class="text-sm text-gray-500">({pagination.total} total)</span>
      </div>

      <a
        href="/contracts/new"
        class="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-500"
        data-testid="new-contract-btn"
      >
        + New Contract
      </a>
    </div>

    <!-- Search -->
    <form method="get" class="mb-4">
      <div class="relative">
        <input
          name="search"
          type="text"
          placeholder="Search by contract number..."
          value={data.search}
          class="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
          data-testid="search-input"
        />
        <svg class="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
    </form>

    <!-- Data Table -->
    <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="w-full text-left text-sm" data-testid="contracts-table">
        <thead class="border-b border-gray-200 bg-gray-50">
          <tr>
            {#each COLUMNS as col}
              <th class="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
                {#if col.sortable}
                  <a href={sortUrl(col.key)} class="hover:text-navy-800" data-testid="sort-{col.key}">
                    {col.label}{sortIndicator(col.key)}
                  </a>
                {:else}
                  {col.label}
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {#if contracts.length === 0}
            <tr>
              <td colspan={COLUMNS.length} class="px-4 py-8 text-center text-gray-400" data-testid="empty-state">
                No contracts found
              </td>
            </tr>
          {:else}
            {#each contracts as contract (contract.id)}
              <tr
                class="cursor-pointer transition-colors hover:bg-gray-50"
                data-testid="contract-row"
              >
                <td class="px-4 py-3">
                  <a href="/contracts/{contract.id}" class="font-medium text-navy-800 hover:underline">
                    {contract.contractNumber}
                  </a>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(contract.status)}"
                    data-testid="status-badge"
                  >
                    {statusLabel(contract.status)}
                  </span>
                </td>
                <td class="px-4 py-3 text-gray-600">{contract.contractType}</td>
                <td class="px-4 py-3 font-medium">{formatCurrency(contract.ceilingValue)}</td>
                <td class="px-4 py-3">{formatCurrency(contract.fundedValue)}</td>
                <td class="px-4 py-3 text-gray-600">{contract.awardingAgency}</td>
                <td class="px-4 py-3 text-gray-600">{formatDate(contract.popStart)}</td>
                <td class="px-4 py-3 text-gray-600">{formatDate(contract.popEnd)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if pagination.totalPages > 1}
      <nav class="mt-4 flex items-center justify-between" data-testid="pagination">
        <span class="text-sm text-gray-500">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <div class="flex gap-1">
          {#if pagination.page > 1}
            <a
              href={pageUrl(pagination.page - 1)}
              class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              data-testid="prev-page"
            >
              Previous
            </a>
          {/if}
          {#if pagination.page < pagination.totalPages}
            <a
              href={pageUrl(pagination.page + 1)}
              class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              data-testid="next-page"
            >
              Next
            </a>
          {/if}
        </div>
      </nav>
    {/if}
  </div>
</div>
