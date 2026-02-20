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
        return "bg-green-500";
      case "DISABLED":
        return "bg-gray-300";
      case "ERROR":
        return "bg-red-500";
      default:
        return "bg-gray-300";
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

<div data-testid="agents-page">
  <!-- System Health -->
  <div class="mb-6" data-testid="system-health">
    <h2 class="mb-3 text-lg font-semibold text-navy-900">System Health</h2>
    <div class="grid grid-cols-4 gap-4">
      <div
        class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        data-testid="health-queue-depth"
      >
        <div class="text-xs font-medium uppercase text-gray-500">
          Queue Depth
        </div>
        <div class="mt-1 text-2xl font-bold text-navy-900">
          {data.health.queueDepth}
        </div>
      </div>
      <div
        class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        data-testid="health-active-tasks"
      >
        <div class="text-xs font-medium uppercase text-gray-500">
          Active Tasks
        </div>
        <div class="mt-1 text-2xl font-bold text-navy-900">
          {data.health.activeTasks}
        </div>
      </div>
      <div
        class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        data-testid="health-error-rate"
      >
        <div class="text-xs font-medium uppercase text-gray-500">
          Error Rate
        </div>
        <div class="mt-1 text-2xl font-bold text-navy-900">
          {formatRate(data.health.errorRate)}
        </div>
      </div>
      <div
        class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        data-testid="health-uptime"
      >
        <div class="text-xs font-medium uppercase text-gray-500">Uptime</div>
        <div class="mt-1 text-2xl font-bold text-navy-900">
          {data.health.uptime}
        </div>
      </div>
    </div>
  </div>

  <!-- Agent Registry -->
  <div class="mb-6">
    <h2 class="mb-3 text-lg font-semibold text-navy-900">Agent Registry</h2>
    <div
      class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <table class="w-full text-left text-sm" data-testid="agent-table">
        <thead class="border-b border-gray-200 bg-gray-50">
          <tr>
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
              >Name</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
              >Type</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
              >Status</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
              >Last Run</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
              >Success Rate</th
            >
            <th
              class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
              >Avg Time</th
            >
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {#each data.agents as agent (agent.id)}
            <tr
              class="cursor-pointer transition-colors hover:bg-gray-50
                {selectedAgentId === agent.id ? 'bg-navy-50' : ''}"
              on:click={() => selectAgent(agent)}
              data-testid="agent-row"
              data-agent-id={agent.id}
            >
              <td
                class="px-3 py-2.5 font-medium text-gray-900"
                data-testid="agent-name">{agent.name}</td
              >
              <td class="px-3 py-2.5 text-gray-600" data-testid="agent-type"
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
                class="px-3 py-2.5 text-gray-600"
                data-testid="agent-last-run"
              >
                {agent.lastRunAt ? formatDate(agent.lastRunAt) : "Never"}
              </td>
              <td
                class="px-3 py-2.5 text-gray-600"
                data-testid="agent-success-rate"
                >{formatRate(agent.successRate)}</td
              >
              <td
                class="px-3 py-2.5 text-gray-600"
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
        <h2 class="text-lg font-semibold text-navy-900">
          Execution History &mdash; {selectedAgent.name}
        </h2>
        {#if data.userRole === "admin"}
          <button
            class="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50"
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
                class="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition-colors hover:bg-gray-50
                  {selectedExecutionId === exec.id
                  ? 'ring-2 ring-accent-500'
                  : ''}"
                on:click={() => selectExecution(exec)}
                data-testid="execution-item"
                data-execution-id={exec.id}
              >
                <div class="flex items-center justify-between">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-medium {executionStatusColor(
                      exec.status,
                    )}"
                    data-testid="exec-status"
                  >
                    {exec.status}
                  </span>
                  <span class="text-xs text-gray-500"
                    >{formatDuration(exec.durationMs)}</span
                  >
                </div>
                <div class="mt-1 text-xs text-gray-600">
                  {formatDate(exec.startedAt)}
                </div>
                <div class="mt-0.5 truncate text-xs text-gray-500">
                  {exec.inputSummary}
                </div>
              </button>
            {/each}
            {#if agentExecutions.length === 0}
              <div
                class="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500"
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
              class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div class="mb-4 flex items-center gap-3">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium {executionStatusColor(
                    selectedExecution.status,
                  )}"
                >
                  {selectedExecution.status}
                </span>
                <span class="text-sm text-gray-600">
                  {formatDate(selectedExecution.startedAt)}
                </span>
                <span class="text-sm text-gray-600" data-testid="detail-duration">
                  Duration: {formatDuration(selectedExecution.durationMs)}
                </span>
              </div>

              <div class="space-y-3">
                <div>
                  <div class="text-xs font-semibold uppercase text-gray-500">
                    Input
                  </div>
                  <div
                    class="mt-1 rounded bg-gray-50 p-3 text-sm text-gray-700"
                    data-testid="detail-input"
                  >
                    {selectedExecution.inputSummary}
                  </div>
                </div>

                {#if selectedExecution.outputSummary}
                  <div>
                    <div
                      class="text-xs font-semibold uppercase text-gray-500"
                    >
                      Output
                    </div>
                    <div
                      class="mt-1 rounded bg-gray-50 p-3 text-sm text-gray-700"
                      data-testid="detail-output"
                    >
                      {selectedExecution.outputSummary}
                    </div>
                  </div>
                {/if}

                {#if selectedExecution.error}
                  <div>
                    <div
                      class="text-xs font-semibold uppercase text-red-600"
                    >
                      Error
                    </div>
                    <div
                      class="mt-1 rounded bg-red-50 p-3 text-sm text-red-700"
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
