<script lang="ts">
  import type { ContractDetail, FsmTransition } from "$lib/types.js";
  import { formatCurrency, formatDate, statusLabel } from "$lib/format.js";

  export let contract: ContractDetail;
  export let transitions: FsmTransition[];

  $: fundedPct = contract.ceilingValue !== "0"
    ? Math.round((parseFloat(contract.fundedValue) / parseFloat(contract.ceilingValue)) * 100)
    : 0;
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-2" data-testid="overview-tab">
  <!-- Contract Info -->
  <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
    <h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Contract Information</h3>
    <dl class="space-y-3 text-sm">
      <div class="flex justify-between">
        <dt class="text-gray-500">Contract Number</dt>
        <dd class="font-medium text-gray-900">{contract.contractNumber}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-gray-500">Type</dt>
        <dd class="font-medium text-gray-900">{contract.contractType}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-gray-500">Agency</dt>
        <dd class="font-medium text-gray-900">{contract.awardingAgency}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-gray-500">CO Name</dt>
        <dd class="font-medium text-gray-900">{contract.contractingOfficerName}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-gray-500">CO Email</dt>
        <dd class="font-medium text-gray-900">{contract.contractingOfficerEmail}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-gray-500">Security Level</dt>
        <dd class="font-medium text-gray-900">{contract.securityLevel}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-gray-500">Period of Performance</dt>
        <dd class="font-medium text-gray-900">{formatDate(contract.popStart)} — {formatDate(contract.popEnd)}</dd>
      </div>
    </dl>
    {#if contract.description}
      <div class="mt-4 border-t border-gray-100 pt-4">
        <p class="text-sm text-gray-600">{contract.description}</p>
      </div>
    {/if}
  </div>

  <!-- Funding & Transitions -->
  <div class="space-y-6">
    <!-- Funding Bar -->
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="funding-chart">
      <h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Funding</h3>
      <div class="space-y-3">
        <div class="flex justify-between text-sm">
          <span class="text-gray-500">Ceiling</span>
          <span class="font-medium">{formatCurrency(contract.ceilingValue)}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-gray-500">Funded</span>
          <span class="font-medium">{formatCurrency(contract.fundedValue)}</span>
        </div>
        <div class="mt-2">
          <div class="h-4 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              class="h-full rounded-full bg-accent-600 transition-all"
              style="width: {Math.min(fundedPct, 100)}%"
              data-testid="funding-bar"
            ></div>
          </div>
          <div class="mt-1 text-right text-xs text-gray-500">{fundedPct}% funded</div>
        </div>
      </div>
    </div>

    <!-- Valid Transitions (FSM) -->
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm" data-testid="transitions-panel">
      <h3 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Available Transitions</h3>
      {#if transitions.length === 0}
        <p class="text-sm text-gray-400">No transitions available from current state</p>
      {:else}
        <div class="flex flex-wrap gap-2">
          {#each transitions as t}
            <button
              class="rounded-md border border-navy-300 bg-white px-3 py-1.5 text-sm font-medium text-navy-800 transition-colors hover:bg-navy-50"
              data-testid="transition-btn"
            >
              {statusLabel(t.to)}
              <span class="ml-1 text-xs text-gray-400">({t.requiredRole})</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
