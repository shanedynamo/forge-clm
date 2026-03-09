<script lang="ts">
  import type { DashboardMetrics, ComplianceItem, ActivityEvent } from "$lib/types.js";
  import { FileText, DollarSign, Wallet, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-svelte";

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

<div class="page-enter">
  <!-- Pulse Strip — Key Metrics -->
  <section data-testid="metrics-section" class="mb-8">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        class="bg-white rounded-lg shadow-sm p-5 border border-slate-300 transition-shadow duration-200 hover:shadow-md"
        data-testid="metric-active-contracts"
      >
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center bg-ash/10 text-ash">
            <FileText size={20} />
          </div>
          <div>
            <div class="font-body text-sm text-slate-700">Active Contracts</div>
            <div class="font-dramatic text-3xl font-bold text-slate-900">{metrics.activeContracts}</div>
          </div>
        </div>
      </div>

      <div
        class="bg-white rounded-lg shadow-sm p-5 border border-slate-300 transition-shadow duration-200 hover:shadow-md"
        data-testid="metric-total-ceiling"
      >
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center bg-ash/10 text-ash">
            <DollarSign size={20} />
          </div>
          <div>
            <div class="font-body text-sm text-slate-700">Total Ceiling Value</div>
            <div class="font-dramatic text-3xl font-bold text-slate-900">{formatCurrency(metrics.totalCeiling)}</div>
          </div>
        </div>
      </div>

      <div
        class="bg-white rounded-lg shadow-sm p-5 border border-slate-300 transition-shadow duration-200 hover:shadow-md"
        data-testid="metric-total-funded"
      >
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center bg-ash/10 text-ash">
            <Wallet size={20} />
          </div>
          <div>
            <div class="font-body text-sm text-slate-700">Total Funded Value</div>
            <div class="font-dramatic text-3xl font-bold text-slate-900">{formatCurrency(metrics.totalFunded)}</div>
          </div>
        </div>
      </div>

      <div
        class="bg-white rounded-lg shadow-sm p-5 border border-slate-300 transition-shadow duration-200 hover:shadow-md"
        data-testid="metric-pending-actions"
      >
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-full flex items-center justify-center bg-ash/10 text-ash">
            <Clock size={20} />
          </div>
          <div>
            <div class="font-body text-sm text-slate-700">Pending Actions</div>
            <div class="font-dramatic text-3xl font-bold text-coral">{metrics.pendingActions}</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- Compliance Status -->
    <section data-testid="compliance-section" class="lg:col-span-1">
      <div class="bg-white rounded-lg shadow-sm p-5 border border-slate-300">
        <h2 class="font-heading font-semibold text-lg text-slate-900 mb-4">Compliance Status</h2>

        {#if data.overdueItems.length > 0}
          <div class="mb-4">
            <div class="mb-2 flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-danger"></span>
              <span class="font-body text-sm font-medium text-danger">
                {data.overdueItems.length} Overdue
              </span>
            </div>
            {#each data.overdueItems.slice(0, 3) as item (item.id)}
              <div class="font-body mb-1 text-sm text-slate-700" data-testid="overdue-item">
                {item.milestoneName} — {item.contractNumber}
              </div>
            {/each}
          </div>
        {/if}

        <div class="mb-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="h-2 w-2 rounded-full bg-warning"></span>
            <span class="font-body text-sm font-medium text-warning">
              {data.complianceDue.length} Due This Week
            </span>
          </div>
          {#each data.complianceDue.slice(0, 5) as item (item.id)}
            <div class="font-body mb-1 text-sm text-slate-700" data-testid="compliance-item">
              {item.milestoneName} — due {formatDate(item.dueDate)}
            </div>
          {/each}
          {#if data.complianceDue.length === 0}
            <div class="font-body text-sm text-slate-400">No items due this week</div>
          {/if}
        </div>
      </div>
    </section>

    <!-- Recent Activity -->
    <section data-testid="activity-section" class="lg:col-span-2">
      <div class="bg-white rounded-lg shadow-sm p-5 border border-slate-300">
        <h2 class="font-heading font-semibold text-lg text-slate-900 mb-4">Recent Activity</h2>

        {#if data.activity.length === 0}
          <div class="font-body text-sm text-slate-400">No recent activity</div>
        {:else}
          <div class="divide-y divide-slate-100">
            {#each data.activity as event (event.id)}
              <div class="flex items-start gap-3 py-3" data-testid="activity-event">
                <div class="mt-0.5 shrink-0">
                  {#if event.status === "SUCCESS"}
                    <CheckCircle2 size={20} class="text-success" />
                  {:else if event.status === "FAILURE"}
                    <XCircle size={20} class="text-danger" />
                  {:else}
                    <Loader2 size={20} class="text-info" />
                  {/if}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-body text-sm font-medium text-slate-900">{statusLabel(event)}</div>
                  <div class="text-xs text-slate-700">
                    <span class="font-mono">{event.taskId}</span> — <span class="font-mono">{formatDate(event.createdAt)}</span>
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
        class="inline-flex items-center gap-2 bg-coral text-white hover:brightness-110 rounded-lg px-4 py-2 font-body font-medium text-sm transition-all duration-150 active:scale-[0.98]"
        data-testid="action-new-nda"
      >
        New NDA
      </a>
      <a
        href="/requests?type=contract"
        class="inline-flex items-center gap-2 bg-coral text-white hover:brightness-110 rounded-lg px-4 py-2 font-body font-medium text-sm transition-all duration-150 active:scale-[0.98]"
        data-testid="action-new-request"
      >
        New Contract Request
      </a>
      <a
        href="/search"
        class="inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 rounded-lg px-4 py-2 font-body font-medium text-sm transition-all duration-150 active:scale-[0.98]"
        data-testid="action-search"
      >
        Search Contracts
      </a>
    </div>
  </section>
</div>
