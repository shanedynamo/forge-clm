<script lang="ts">
  import type { DashboardMetrics, ComplianceItem, ActivityEvent } from "$lib/types.js";

  export let data: {
    metrics: DashboardMetrics | null;
    complianceDue: ComplianceItem[];
    overdueItems: ComplianceItem[];
    activity: ActivityEvent[];
  };

  const metrics = data.metrics ?? {
    activeContracts: 0,
    totalCeiling: 0,
    totalFunded: 0,
    pendingActions: 0,
  };

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function statusLabel(event: ActivityEvent): string {
    const type = event.agentType ?? "system";
    return `${type.replace(/_/g, " ")} — ${event.status}`;
  }
</script>

<!-- Key Metrics -->
<section data-testid="metrics-section" class="mb-8">
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="metric-active-contracts">
      <div class="text-sm font-medium text-gray-500">Active Contracts</div>
      <div class="mt-2 text-3xl font-bold text-navy-900">{metrics.activeContracts}</div>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="metric-total-ceiling">
      <div class="text-sm font-medium text-gray-500">Total Ceiling Value</div>
      <div class="mt-2 text-3xl font-bold text-navy-900">{formatCurrency(metrics.totalCeiling)}</div>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="metric-total-funded">
      <div class="text-sm font-medium text-gray-500">Total Funded Value</div>
      <div class="mt-2 text-3xl font-bold text-navy-900">{formatCurrency(metrics.totalFunded)}</div>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="metric-pending-actions">
      <div class="text-sm font-medium text-gray-500">Pending Actions</div>
      <div class="mt-2 text-3xl font-bold text-accent-600">{metrics.pendingActions}</div>
    </div>
  </div>
</section>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
  <!-- Compliance Status -->
  <section data-testid="compliance-section" class="lg:col-span-1">
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 class="mb-4 text-lg font-semibold text-navy-900">Compliance Status</h2>

      {#if data.overdueItems.length > 0}
        <div class="mb-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="h-2 w-2 rounded-full bg-red-500"></span>
            <span class="text-sm font-medium text-red-700">
              {data.overdueItems.length} Overdue
            </span>
          </div>
          {#each data.overdueItems.slice(0, 3) as item (item.id)}
            <div class="mb-1 text-sm text-gray-600" data-testid="overdue-item">
              {item.milestoneName} — {item.contractNumber}
            </div>
          {/each}
        </div>
      {/if}

      <div class="mb-4">
        <div class="mb-2 flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-amber-500"></span>
          <span class="text-sm font-medium text-amber-700">
            {data.complianceDue.length} Due This Week
          </span>
        </div>
        {#each data.complianceDue.slice(0, 5) as item (item.id)}
          <div class="mb-1 text-sm text-gray-600" data-testid="compliance-item">
            {item.milestoneName} — due {formatDate(item.dueDate)}
          </div>
        {/each}
        {#if data.complianceDue.length === 0}
          <div class="text-sm text-gray-400">No items due this week</div>
        {/if}
      </div>
    </div>
  </section>

  <!-- Recent Activity -->
  <section data-testid="activity-section" class="lg:col-span-2">
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 class="mb-4 text-lg font-semibold text-navy-900">Recent Activity</h2>

      {#if data.activity.length === 0}
        <div class="text-sm text-gray-400">No recent activity</div>
      {:else}
        <div class="divide-y divide-gray-100">
          {#each data.activity as event (event.id)}
            <div class="flex items-start gap-3 py-3" data-testid="activity-event">
              <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                {event.status === 'SUCCESS' ? 'bg-green-100 text-green-600' :
                 event.status === 'FAILURE' ? 'bg-red-100 text-red-600' :
                 'bg-blue-100 text-blue-600'}">
                <span class="text-xs font-medium">
                  {event.status === "SUCCESS" ? "OK" : event.status === "FAILURE" ? "!" : "..."}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-gray-900">{statusLabel(event)}</div>
                <div class="text-xs text-gray-500">
                  {event.taskId} — {formatDate(event.createdAt)}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</div>

<!-- Quick Actions -->
<section data-testid="quick-actions" class="mt-6">
  <div class="flex flex-wrap gap-3">
    <a
      href="/requests?type=nda"
      class="inline-flex items-center gap-2 rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-700"
      data-testid="action-new-nda"
    >
      New NDA
    </a>
    <a
      href="/requests?type=contract"
      class="inline-flex items-center gap-2 rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-700"
      data-testid="action-new-request"
    >
      New Contract Request
    </a>
    <a
      href="/search"
      class="inline-flex items-center gap-2 rounded-md border border-navy-300 bg-white px-4 py-2 text-sm font-medium text-navy-800 transition-colors hover:bg-gray-50"
      data-testid="action-search"
    >
      Search Contracts
    </a>
  </div>
</section>
