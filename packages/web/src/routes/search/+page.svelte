<script lang="ts">
  import type { SearchResult, AskResponse, Citation, ContractSummary } from "$lib/types.js";
  import { Search, SearchX } from "lucide-svelte";

  // ─── Props for testability (override internal state) ────────────
  export let initialMode: "search" | "ask" = "search";
  export let initialResults: SearchResult[] | null = null;
  export let initialAnswer: AskResponse | null = null;
  export let initialLoading: boolean = false;
  export let initialQuery: string = "";
  export let contracts: ContractSummary[] = [];

  // ─── Internal state ─────────────────────────────────────────────
  let mode: "search" | "ask" = initialMode;
  let query = initialQuery;
  let loading = initialLoading;
  let results: SearchResult[] | null = initialResults;
  let answer: AskResponse | null = initialAnswer;
  let error: string | null = null;

  // Filters
  let filterContractId = "";
  let filterSectionType = "";
  let filterDateFrom = "";
  let filterDateTo = "";

  // Ask mode
  let scopeContractId = "";

  // Citation expansion
  let expandedCitationIdx: number | null = null;

  const SECTION_TYPES = ["clause", "deliverable", "modification", "option", "communication"];

  function confidenceLabel(score: number): { text: string; color: string } {
    if (score >= 0.8) return { text: "High", color: "bg-green-100 text-green-700" };
    if (score >= 0.5) return { text: "Medium", color: "bg-amber-100 text-amber-700" };
    return { text: "Low", color: "bg-red-100 text-red-700" };
  }

  async function handleSubmit() {
    if (!query.trim()) return;
    loading = true;
    error = null;
    results = null;
    answer = null;

    try {
      const apiBase = "http://localhost:3000/api/v1";
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (mode === "search") {
        const body: Record<string, string> = { query };
        if (filterContractId) body.contractId = filterContractId;
        if (filterSectionType) body.sectionType = filterSectionType;
        if (filterDateFrom) body.dateFrom = filterDateFrom;
        if (filterDateTo) body.dateTo = filterDateTo;

        const res = await fetch(`${apiBase}/search`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Search request failed");
        results = await res.json();
      } else {
        const body: Record<string, string> = { question: query };
        if (scopeContractId) body.contract_id = scopeContractId;

        const res = await fetch(`${apiBase}/ask`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Ask request failed");
        answer = await res.json();
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "An error occurred";
    } finally {
      loading = false;
    }
  }

  function toggleCitation(idx: number) {
    expandedCitationIdx = expandedCitationIdx === idx ? null : idx;
  }
</script>

<div class="page-enter" data-testid="search-page">
  <!-- Mode Toggle -->
  <div class="mb-6 flex items-center gap-4">
    <div class="inline-flex rounded-lg border border-slate-300 bg-white p-1">
      <button
        class="rounded-md px-4 py-2 text-sm font-medium font-body transition-colors
          {mode === 'search' ? 'bg-coral text-white' : 'text-slate-600 hover:text-slate-900'}"
        on:click={() => { mode = "search"; results = null; answer = null; }}
        data-testid="mode-search"
      >
        Search
      </button>
      <button
        class="rounded-md px-4 py-2 text-sm font-medium font-body transition-colors
          {mode === 'ask' ? 'bg-coral text-white' : 'text-slate-600 hover:text-slate-900'}"
        on:click={() => { mode = "ask"; results = null; answer = null; }}
        data-testid="mode-ask"
      >
        Ask AI
      </button>
    </div>
    <span class="font-body text-sm text-slate-500">
      {mode === "search" ? "Search across contract documents" : "Ask questions about your contracts"}
    </span>
  </div>

  <!-- Search Input -->
  <form on:submit|preventDefault={handleSubmit} class="mb-6" data-testid="search-form">
    <div class="relative">
      <input
        bind:value={query}
        type="text"
        placeholder={mode === "search"
          ? "Search contract clauses, deliverables, modifications..."
          : "Ask a question about your contracts..."}
        class="w-full rounded-xl border border-slate-300 bg-white py-4 pl-12 pr-32 shadow-sm font-body text-lg focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/50"
        data-testid="search-input"
      />
      <div class="absolute left-4 top-5">
        <Search class="h-5 w-5 text-slate-400" strokeWidth={1.5} />
      </div>
      <button
        type="submit"
        class="absolute right-3 top-3 rounded-lg bg-coral px-5 py-2 text-sm font-body font-medium text-white hover:brightness-110 transition-all duration-150 active:scale-[0.98]"
        data-testid="search-submit"
      >
        {mode === "search" ? "Search" : "Ask"}
      </button>
    </div>
  </form>

  <div class="flex gap-6">
    <!-- Filters Sidebar (Search mode only) -->
    {#if mode === "search"}
      <aside class="hidden w-56 shrink-0 lg:block" data-testid="search-filters">
        <div class="space-y-4 border border-slate-300 bg-white rounded-lg shadow-sm p-4">
          <h3 class="font-heading text-sm font-semibold text-slate-900">Filters</h3>

          <div>
            <label for="filter-contract" class="block font-body text-xs font-medium text-slate-700">Contract</label>
            <select
              id="filter-contract"
              bind:value={filterContractId}
              class="mt-1 w-full rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
              data-testid="filter-contract"
            >
              <option value="">All contracts</option>
              {#each contracts as c}
                <option value={c.id}>{c.contractNumber}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="filter-section" class="block font-body text-xs font-medium text-slate-700">Section Type</label>
            <select
              id="filter-section"
              bind:value={filterSectionType}
              class="mt-1 w-full rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
              data-testid="filter-section-type"
            >
              <option value="">All types</option>
              {#each SECTION_TYPES as s}
                <option value={s}>{s}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="filter-from" class="block font-body text-xs font-medium text-slate-700">Date From</label>
            <input
              id="filter-from"
              type="date"
              bind:value={filterDateFrom}
              class="mt-1 w-full rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
              data-testid="filter-date-from"
            />
          </div>

          <div>
            <label for="filter-to" class="block font-body text-xs font-medium text-slate-700">Date To</label>
            <input
              id="filter-to"
              type="date"
              bind:value={filterDateTo}
              class="mt-1 w-full rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
              data-testid="filter-date-to"
            />
          </div>
        </div>
      </aside>
    {/if}

    <!-- Results Area -->
    <div class="min-w-0 flex-1">
      <!-- Loading State -->
      {#if loading}
        <div class="space-y-4" data-testid="loading-skeletons">
          {#each [1, 2, 3] as _}
            <div class="animate-pulse rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
              <div class="mb-3 h-4 w-1/3 dynamo-skeleton"></div>
              <div class="mb-2 h-3 w-full dynamo-skeleton"></div>
              <div class="mb-2 h-3 w-5/6 dynamo-skeleton"></div>
              <div class="h-3 w-2/3 dynamo-skeleton"></div>
            </div>
          {/each}
        </div>

      <!-- Error -->
      {:else if error}
        <div class="rounded-lg border border-danger/30 bg-danger/5 p-5 text-sm text-danger font-body" data-testid="error-message">
          {error}
        </div>

      <!-- Search Results -->
      {:else if mode === "search" && results !== null}
        {#if results.length === 0}
          <div class="rounded-lg border border-slate-300 bg-white p-8 text-center" data-testid="empty-results">
            <div class="mx-auto mb-3">
              <SearchX class="mx-auto h-12 w-12 text-slate-300" />
            </div>
            <h3 class="font-heading text-sm font-medium text-slate-900">No results found</h3>
            <p class="mt-2 font-body text-sm text-slate-500" data-testid="suggestions">
              Try broadening your search terms, removing filters, or searching for specific clause numbers like "52.219-8"
            </p>
          </div>
        {:else}
          <div class="space-y-3" data-testid="search-results">
            {#each results as result (result.id)}
              <a
                href="/contracts/{result.contractId}?tab=clauses{result.clauseNumber ? `&clause=${result.clauseNumber}` : ''}"
                class="block border border-slate-300 bg-white rounded-lg p-4 shadow-sm hover:border-coral/30 hover:shadow-md transition-all duration-200"
                data-testid="search-result"
              >
                <div class="mb-2 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-heading text-sm font-semibold text-coral">{result.contractNumber}</span>
                    {#if result.clauseNumber}
                      <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-600">
                        {result.clauseNumber}
                      </span>
                    {/if}
                    <span class="rounded bg-info/10 px-1.5 py-0.5 text-xs text-info font-body">
                      {result.sectionType}
                    </span>
                  </div>
                  <span
                    class="rounded-full px-2.5 py-0.5 text-xs font-medium font-mono
                      {result.similarity >= 0.8 ? 'bg-green-100 text-green-700' :
                       result.similarity >= 0.5 ? 'bg-amber-100 text-amber-700' :
                       'bg-gray-100 text-gray-600'}"
                    data-testid="similarity-score"
                  >
                    {Math.round(result.similarity * 100)}% match
                  </span>
                </div>
                <p class="font-body text-sm text-slate-700" data-testid="chunk-text">
                  {result.chunkText}
                </p>
              </a>
            {/each}
          </div>
        {/if}

      <!-- Ask Response -->
      {:else if mode === "ask" && answer !== null}
        <div class="space-y-4" data-testid="ask-response">
          <!-- Confidence Indicator -->
          <div class="flex items-center gap-2">
            <span class="font-body text-xs text-slate-500">Confidence:</span>
            <span
              class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-mono {confidenceLabel(answer.confidence).color}"
              data-testid="confidence-indicator"
            >
              {confidenceLabel(answer.confidence).text} ({Math.round(answer.confidence * 100)}%)
            </span>
          </div>

          <!-- Answer -->
          <div class="border border-slate-300 bg-white rounded-lg p-5 shadow-sm" data-testid="ai-answer">
            <div class="mb-2 flex items-center gap-2">
              <div class="flex h-6 w-6 items-center justify-center rounded-full bg-coral-100 text-xs font-bold text-coral-700">
                AI
              </div>
              <span class="font-body text-xs font-medium text-slate-500">Forge Intelligence</span>
            </div>
            <div class="prose prose-sm max-w-none font-body text-slate-800">
              <p>{answer.answer}</p>
            </div>
          </div>

          <!-- Citations -->
          {#if answer.citations.length > 0}
            <div data-testid="citations-section">
              <h3 class="mb-2 font-heading text-sm font-semibold text-slate-900">
                Sources ({answer.citations.length})
              </h3>
              <div class="space-y-2">
                {#each answer.citations as citation, idx}
                  <div class="border border-slate-300 bg-white rounded-lg shadow-sm" data-testid="citation">
                    <button
                      class="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-slate-100 font-body"
                      on:click={() => toggleCitation(idx)}
                      data-testid="citation-toggle"
                    >
                      <div class="flex items-center gap-2">
                        <a
                          href="/contracts/{citation.contractId}"
                          class="font-heading font-medium text-coral hover:text-coral-700"
                          on:click|stopPropagation
                          data-testid="citation-link"
                        >
                          {citation.contractNumber}
                        </a>
                        {#if citation.clauseNumber}
                          <span class="font-mono text-xs text-slate-500">{citation.clauseNumber}</span>
                        {/if}
                        <span class="font-body text-xs text-slate-500">{citation.sectionType}</span>
                      </div>
                      <span class="font-mono text-xs text-slate-500">{Math.round(citation.relevance * 100)}% relevance</span>
                    </button>

                    {#if expandedCitationIdx === idx}
                      <div class="border-t border-slate-200 px-4 py-3" data-testid="citation-source-text">
                        <p class="font-body text-sm text-slate-600">{citation.chunkText}</p>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

      <!-- Ask mode empty results -->
      {:else if mode === "ask" && answer !== null && !answer.answer}
        <div class="rounded-lg border border-slate-300 bg-white p-8 text-center" data-testid="empty-results">
          <div class="mx-auto mb-3">
            <SearchX class="mx-auto h-12 w-12 text-slate-300" />
          </div>
          <h3 class="font-heading text-sm font-medium text-slate-900">No answer found</h3>
          <p class="mt-2 font-body text-sm text-slate-500" data-testid="suggestions">
            Try rephrasing your question or scoping it to a specific contract for better results
          </p>
        </div>
      {/if}
    </div>

    <!-- Contract Scope (Ask mode) -->
    {#if mode === "ask"}
      <aside class="hidden w-56 shrink-0 lg:block" data-testid="ask-sidebar">
        <div class="space-y-4 border border-slate-300 bg-white rounded-lg shadow-sm p-4">
          <h3 class="font-heading text-sm font-semibold text-slate-900">Scope</h3>
          <div>
            <label for="scope-contract" class="block font-body text-xs font-medium text-slate-700">Contract</label>
            <select
              id="scope-contract"
              bind:value={scopeContractId}
              class="mt-1 w-full rounded-lg border-slate-300 text-sm font-body focus:border-coral focus:ring-2 focus:ring-coral/50"
              data-testid="scope-contract"
            >
              <option value="">All contracts</option>
              {#each contracts as c}
                <option value={c.id}>{c.contractNumber}</option>
              {/each}
            </select>
          </div>
        </div>
      </aside>
    {/if}
  </div>
</div>
