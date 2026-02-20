<script lang="ts">
  import type { Communication } from "$lib/types.js";
  import { formatDate } from "$lib/format.js";

  export let communications: Communication[];
</script>

<div data-testid="communications-tab">
  {#if communications.length === 0}
    <p class="text-sm text-gray-400">No communications found</p>
  {:else}
    <div class="space-y-3">
      {#each communications as comm (comm.id)}
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm" data-testid="comm-item">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium
                  {comm.direction === 'INBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}"
                data-testid="direction-badge"
              >
                {comm.direction === "INBOUND" ? "\u2190 IN" : "\u2192 OUT"}
              </span>
              <span class="text-xs text-gray-400">{comm.channel}</span>
            </div>
            <span class="text-xs text-gray-400">{formatDate(comm.createdAt)}</span>
          </div>
          <h4 class="mt-2 text-sm font-medium text-gray-900">{comm.subject}</h4>
          <p class="mt-1 text-sm text-gray-600">{comm.summary}</p>
        </div>
      {/each}
    </div>
  {/if}
</div>
