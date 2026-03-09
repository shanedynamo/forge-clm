<script lang="ts">
  import type { Communication } from "$lib/types.js";
  import { formatDate } from "$lib/format.js";

  export let communications: Communication[];
</script>

<div data-testid="communications-tab">
  {#if communications.length === 0}
    <p class="text-sm font-body text-slate-400">No communications found</p>
  {:else}
    <div class="space-y-3">
      {#each communications as comm (comm.id)}
        <div class="border border-slate-300 bg-white rounded-lg shadow-sm p-4 transition-shadow duration-200 hover:shadow-md" data-testid="comm-item">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium
                  {comm.direction === 'INBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}"
                data-testid="direction-badge"
              >
                {comm.direction === "INBOUND" ? "\u2190 IN" : "\u2192 OUT"}
              </span>
              <span class="text-xs font-body text-slate-400">{comm.channel}</span>
            </div>
            <span class="text-xs font-mono text-slate-400">{formatDate(comm.createdAt)}</span>
          </div>
          <h4 class="mt-2 text-sm font-heading font-medium text-slate-900">{comm.subject}</h4>
          <p class="mt-1 text-sm font-body text-slate-700">{comm.summary}</p>
        </div>
      {/each}
    </div>
  {/if}
</div>
