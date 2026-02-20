<script lang="ts">
  import type { Modification } from "$lib/types.js";
  import { formatCurrency, formatDate, statusColor, statusLabel } from "$lib/format.js";

  export let modifications: Modification[];
</script>

<div data-testid="modifications-tab">
  {#if modifications.length === 0}
    <p class="text-sm text-gray-400">No modifications found</p>
  {:else}
    <div class="relative">
      <!-- Timeline line -->
      <div class="absolute left-4 top-0 h-full w-0.5 bg-gray-200"></div>

      <div class="space-y-4">
        {#each modifications as mod (mod.id)}
          <div class="relative flex gap-4 pl-10" data-testid="mod-item">
            <!-- Timeline dot -->
            <div class="absolute left-2.5 top-4 h-3 w-3 rounded-full border-2 border-white bg-navy-600"></div>

            <div class="flex-1 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div class="flex items-start justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-navy-900">{mod.modNumber}</span>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(mod.status)}"
                      data-testid="mod-status"
                    >
                      {statusLabel(mod.status)}
                    </span>
                  </div>
                  <p class="mt-1 text-sm text-gray-600">{mod.description}</p>
                </div>
                <span class="text-xs text-gray-400">{formatDate(mod.effectiveDate)}</span>
              </div>

              <div class="mt-3 flex gap-4 text-sm">
                <div>
                  <span class="text-gray-500">Type:</span>
                  <span class="ml-1 font-medium">{mod.modType}</span>
                </div>
                <div>
                  <span class="text-gray-500">Ceiling &Delta;:</span>
                  <span class="ml-1 font-medium {parseFloat(mod.ceilingDelta) >= 0 ? 'text-green-700' : 'text-red-700'}">
                    {formatCurrency(mod.ceilingDelta)}
                  </span>
                </div>
                <div>
                  <span class="text-gray-500">Funding &Delta;:</span>
                  <span class="ml-1 font-medium {parseFloat(mod.fundingDelta) >= 0 ? 'text-green-700' : 'text-red-700'}">
                    {formatCurrency(mod.fundingDelta)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
