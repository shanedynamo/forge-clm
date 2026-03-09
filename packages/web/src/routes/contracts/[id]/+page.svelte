<script lang="ts">
  import type {
    ContractDetail,
    ContractClause,
    Modification,
    Deliverable,
    ComplianceItem,
    ContractOption,
    Communication,
    FsmTransition,
  } from "$lib/types.js";
  import OverviewTab from "../../../components/contract/OverviewTab.svelte";
  import ClausesTab from "../../../components/contract/ClausesTab.svelte";
  import ModificationsTab from "../../../components/contract/ModificationsTab.svelte";
  import DeliverablesTab from "../../../components/contract/DeliverablesTab.svelte";
  import ComplianceTab from "../../../components/contract/ComplianceTab.svelte";
  import OptionsTab from "../../../components/contract/OptionsTab.svelte";
  import DocumentsTab from "../../../components/contract/DocumentsTab.svelte";
  import CommunicationsTab from "../../../components/contract/CommunicationsTab.svelte";

  export let data: {
    contract: ContractDetail | null;
    clauses: ContractClause[];
    modifications: Modification[];
    deliverables: Deliverable[];
    compliance: ComplianceItem[];
    options: ContractOption[];
    communications: Communication[];
    transitions: FsmTransition[];
  };

  const TABS = [
    "Overview",
    "Clauses",
    "Modifications",
    "Deliverables",
    "Compliance",
    "Options",
    "Documents",
    "Communications",
  ] as const;

  let activeTab: (typeof TABS)[number] = "Overview";

  $: contract = data.contract;
</script>

{#if !contract}
  <div class="font-body text-center text-slate-500 py-12" data-testid="not-found">
    Contract not found
  </div>
{:else}
  <div class="page-enter" data-testid="contract-detail">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between">
      <div>
        <div class="flex items-center gap-3">
          <a href="/contracts" class="font-body text-sm text-slate-500 hover:text-coral">&larr; Contracts</a>
        </div>
        <h1 class="mt-1 font-heading text-2xl font-bold text-slate-900" data-testid="contract-number">
          {contract.contractNumber}
        </h1>
        <p class="mt-1 font-body text-sm text-slate-500">{contract.awardingAgency} &middot; {contract.contractType}</p>
      </div>
      <span
        class="font-body inline-flex items-center rounded-full px-3 py-1 text-sm font-medium
          {contract.status === 'ACTIVE' ? 'bg-success/10 text-success' :
           contract.status === 'CLOSED' ? 'bg-slate-200 text-slate-600' :
           'bg-info/10 text-info'}"
        data-testid="contract-status"
      >
        {contract.status.replace(/_/g, " ")}
      </span>
    </div>

    <!-- Tab Navigation -->
    <div class="mb-6 border-b border-slate-300">
      <nav class="-mb-px flex gap-6" data-testid="tab-nav">
        {#each TABS as tab}
          <button
            class="whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors duration-150
              {activeTab === tab
                ? 'border-coral text-slate-900 font-heading'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 font-body'}"
            on:click={() => (activeTab = tab)}
            data-testid="tab-{tab.toLowerCase()}"
          >
            {tab}
          </button>
        {/each}
      </nav>
    </div>

    <!-- Tab Content -->
    <div data-testid="tab-content">
      {#if activeTab === "Overview"}
        <OverviewTab {contract} transitions={data.transitions} />
      {:else if activeTab === "Clauses"}
        <ClausesTab clauses={data.clauses} />
      {:else if activeTab === "Modifications"}
        <ModificationsTab modifications={data.modifications} />
      {:else if activeTab === "Deliverables"}
        <DeliverablesTab deliverables={data.deliverables} />
      {:else if activeTab === "Compliance"}
        <ComplianceTab compliance={data.compliance} />
      {:else if activeTab === "Options"}
        <OptionsTab options={data.options} />
      {:else if activeTab === "Documents"}
        <DocumentsTab />
      {:else if activeTab === "Communications"}
        <CommunicationsTab communications={data.communications} />
      {/if}
    </div>
  </div>
{/if}
