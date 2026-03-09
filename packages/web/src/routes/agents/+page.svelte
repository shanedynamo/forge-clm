<script lang="ts">
  import type {
    AgentRegistryEntry,
    AgentExecution,
    SystemHealth,
    AuthRole,
    ExecutionStatus,
  } from "$lib/types.js";
  import { formatDate } from "$lib/format.js";

  export let data: { agents: AgentRegistryEntry[]; health: SystemHealth; userRole: AuthRole };

  // Testability props
  export let initialExecutions: AgentExecution[] = [];
  export let initialSelectedAgentId: string | null = null;

  let selectedAgentId: string | null = initialSelectedAgentId;
  let executions: AgentExecution[] = initialExecutions;
  let selectedExecutionId: string | null = null;
  let triggerLoading = false;

  function selectAgent(agent: AgentRegistryEntry) {
    selectedAgentId = agent.id;
    selectedExecutionId = null;
  }

  function selectExecution(exec: AgentExecution) {
    selectedExecutionId = exec.id;
  }

  async function triggerRun() {
    if (!selectedAgentId) return;
    triggerLoading = true;
    setTimeout(() => {
      triggerLoading = false;
    }, 1000);
  }

  function executionStatusColor(status: ExecutionStatus): string {
    switch (status) {
      case "SUCCESS":
        return "bg-green-100 text-green-700";
      case "FAILED":
        return "bg-red-100 text-red-700";
      case "RUNNING":
        return "bg-blue-100 text-blue-700";
      case "CANCELLED":
        return "bg-gray-100 text-gray-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  }

  function agentStatusColor(status: string): string {
    switch (status) {
      case "ENABLED":
        return "bg-success";
      case "DISABLED":
        return "bg-slate-300";
      case "ERROR":
        return "bg-danger";
      default:
        return "bg-slate-300";
    }
  }

  function formatDuration(ms: number | null): string {
    if (ms === null || ms === 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatRate(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }

  $: selectedAgent = data.agents.find((a) => a.id === selectedAgentId) ?? null;
  $: agentExecutions = executions.filter((e) => e.agentId === selectedAgentId);
  $: selectedExecution =
    executions.find((e) => e.id === selectedExecutionId) ?? null;
</script>

<div class="page-enter" data-testid="agents-page">
  <!-- System Health -->
  <div class="mb-6" data-testid="system-health">
    <h2 class="mb-3 font-heading font-semibold text-lg text-slate-900">System Health</h2>
    <div class="grid grid-cols-4 gap-4">
      <div
        class="border border-slate-300 bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow duration-200"
        data-testid="health-queue-depth"
      >
        <div class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide">
          Queue Depth
        </div>
        <div class="mt-1 font-dramatic text-2xl font-bold text-slate-900">
          {data.health.queueDepth}
        </div>
      </div>
      <div
        class="border border-slate-300 bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow duration-200"
        data-testid="health-active-tasks"
      >
        <div class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide">
          Active Tasks
        </div>
        <div class="mt-1 font-dramatic text-2xl font-bold text-slate-900">
          {data.health.activeTasks}
        </div>
      </div>
      <div
        class="border border-slate-300 bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow duration-200"
        data-testid="health-error-rate"
      >
        <div class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide">
          Error Rate
        </div>
        <div class="mt-1 font-dramatic text-2xl font-bold text-slate-900">
          {formatRate(data.health.errorRate)}
        </div>
      </div>
      <div
        class="border border-slate-300 bg-white rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow duration-200"
        data-testid="health-uptime"
      >
        <div class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide">Uptime</div>
        <div class="mt-1 font-dramatic text-2xl font-bold text-slate-900">
          {data.health.uptime}
        </div>
      </div>
    </div>
  </div>

  <!-- Agent Registry -->
  <div class="mb-6">
    <h2 class="mb-3 font-heading font-semibold text-lg text-slate-900">Agent Registry</h2>
    <div
      class="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
    >
      <table class="dynamo-table w-full text-left text-sm" data-testid="agent-table">
        <thead class="bg-slate-100">
          <tr>
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
              >Name</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
              >Type</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
              >Status</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
              >Last Run</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
              >Success Rate</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700 font-heading"
              >Avg Time</th
            >
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
          {#each data.agents as agent (agent.id)}
            <tr
              class="cursor-pointer transition-colors hover:bg-slate-100/50
                {selectedAgentId === agent.id ? 'bg-coral-50' : ''}"
              on:click={() => selectAgent(agent)}
              data-testid="agent-row"
              data-agent-id={agent.id}
            >
              <td
                class="px-3 py-2.5 font-body font-medium text-slate-900"
                data-testid="agent-name">{agent.name}</td
              >
              <td class="px-3 py-2.5 text-slate-600" data-testid="agent-type"
                >{agent.type.replace(/_/g, " ")}</td
              >
              <td class="px-3 py-2.5" data-testid="agent-status">
                <span class="inline-flex items-center gap-1.5">
                  <span
                    class="inline-block h-2 w-2 rounded-full {agentStatusColor(
                      agent.status,
                    )}"
                    data-testid="status-dot"
                  ></span>
                  {agent.status}
                </span>
              </td>
              <td
                class="px-3 py-2.5 font-mono text-slate-700"
                data-testid="agent-last-run"
              >
                {agent.lastRunAt ? formatDate(agent.lastRunAt) : "Never"}
              </td>
              <td
                class="px-3 py-2.5 font-mono text-slate-600"
                data-testid="agent-success-rate"
                >{formatRate(agent.successRate)}</td
              >
              <td
                class="px-3 py-2.5 font-mono text-slate-600"
                data-testid="agent-avg-time"
                >{formatDuration(agent.avgExecutionTimeMs)}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Execution History Panel -->
  {#if selectedAgent}
    <div data-testid="execution-panel">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-heading font-semibold text-lg text-slate-900">
          Execution History &mdash; {selectedAgent.name}
        </h2>
        {#if data.userRole === "admin"}
          <button
            class="rounded-lg bg-coral px-4 py-2 text-sm font-medium text-white hover:brightness-110 transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
            on:click={triggerRun}
            disabled={triggerLoading}
            data-testid="trigger-btn"
          >
            {triggerLoading ? "Triggering..." : "Trigger Run"}
          </button>
        {/if}
      </div>

      <div class="flex gap-4">
        <!-- Execution List -->
        <div class="w-80 shrink-0">
          <div class="space-y-2">
            {#each agentExecutions as exec (exec.id)}
              <button
                class="w-full border border-slate-300 bg-white rounded-lg p-3 text-left shadow-sm hover:shadow-md transition-shadow duration-200
                  {selectedExecutionId === exec.id
                  ? 'ring-2 ring-coral'
                  : ''}"
                on:click={() => selectExecution(exec)}
                data-testid="execution-item"
                data-execution-id={exec.id}
              >
                <div class="flex items-center justify-between">
                  <span
                    class="rounded-full px-2.5 py-0.5 text-xs font-medium {executionStatusColor(
                      exec.status,
                    )}"
                    data-testid="exec-status"
                  >
                    {exec.status}
                  </span>
                  <span class="font-mono text-xs text-slate-700"
                    >{formatDuration(exec.durationMs)}</span
                  >
                </div>
                <div class="mt-1 font-mono text-xs text-slate-700">
                  {formatDate(exec.startedAt)}
                </div>
                <div class="mt-0.5 truncate text-xs text-slate-500">
                  {exec.inputSummary}
                </div>
              </button>
            {/each}
            {#if agentExecutions.length === 0}
              <div
                class="border border-slate-300 bg-white rounded-lg p-4 text-center text-sm text-slate-500 shadow-sm"
                data-testid="no-executions"
              >
                No executions found
              </div>
            {/if}
          </div>
        </div>

        <!-- Execution Detail -->
        {#if selectedExecution}
          <div class="min-w-0 flex-1" data-testid="execution-detail">
            <div
              class="border border-slate-300 bg-white rounded-lg p-5 shadow-sm"
            >
              <div class="mb-4 flex items-center gap-3">
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-medium {executionStatusColor(
                    selectedExecution.status,
                  )}"
                >
                  {selectedExecution.status}
                </span>
                <span class="font-mono text-sm text-slate-700">
                  {formatDate(selectedExecution.startedAt)}
                </span>
                <span class="font-mono text-sm text-slate-700" data-testid="detail-duration">
                  Duration: {formatDuration(selectedExecution.durationMs)}
                </span>
              </div>

              <div class="space-y-3">
                <div>
                  <div class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide">
                    Input
                  </div>
                  <div
                    class="mt-1 rounded-lg bg-slate-100 p-3 font-mono text-sm text-slate-700"
                    data-testid="detail-input"
                  >
                    {selectedExecution.inputSummary}
                  </div>
                </div>

                {#if selectedExecution.outputSummary}
                  <div>
                    <div
                      class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide"
                    >
                      Output
                    </div>
                    <div
                      class="mt-1 rounded-lg bg-slate-100 p-3 font-mono text-sm text-slate-700"
                      data-testid="detail-output"
                    >
                      {selectedExecution.outputSummary}
                    </div>
                  </div>
                {/if}

                {#if selectedExecution.error}
                  <div>
                    <div
                      class="text-xs font-semibold uppercase text-slate-500 font-heading tracking-wide"
                    >
                      Error
                    </div>
                    <div
                      class="mt-1 rounded-lg bg-danger/5 p-3 font-mono text-sm text-danger"
                      data-testid="detail-error"
                    >
                      {selectedExecution.error}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
