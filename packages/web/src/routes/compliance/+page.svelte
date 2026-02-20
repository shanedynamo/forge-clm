<script lang="ts">
  import type {
    ComplianceItem,
    OverdueItem,
    FundingStatus,
    OptionWindow,
    CalendarDeadline,
  } from "$lib/types.js";
  import {
    formatCurrency,
    formatDate,
    daysUntil,
    statusColor,
    statusLabel,
  } from "$lib/format.js";

  export let data: {
    dueThisWeek: ComplianceItem[];
    overdueItems: OverdueItem[];
    upcoming: ComplianceItem[];
    optionWindows: OptionWindow[];
    fundingStatus: FundingStatus[];
    calendarDeadlines: CalendarDeadline[];
    calendarYear: number;
    calendarMonth: number;
  };

  // ─── Calendar state ─────────────────────────────────────────────
  let selectedDate: string | null = null;

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const DEADLINE_TYPE_COLORS: Record<string, string> = {
    deliverable: "bg-blue-500",
    option: "bg-purple-500",
    compliance: "bg-green-500",
    funding: "bg-orange-500",
  };

  function calendarDays(year: number, month: number) {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: { day: number; inMonth: boolean; dateStr: string }[] = [];

    // Padding from previous month
    const prevMonthDays = new Date(year, month - 1, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = month - 1 < 1 ? 12 : month - 1;
      const y = month - 1 < 1 ? year - 1 : year;
      days.push({ day: d, inMonth: false, dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({
        day: d,
        inMonth: true,
        dateStr: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }

    // Padding to fill remaining cells (up to 42 = 6 rows)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = month + 1 > 12 ? 1 : month + 1;
      const y = month + 1 > 12 ? year + 1 : year;
      days.push({ day: d, inMonth: false, dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
    }

    return days;
  }

  function deadlinesForDate(dateStr: string): CalendarDeadline[] {
    return data.calendarDeadlines.filter((d) => d.date === dateStr);
  }

  // ─── Overdue sort state ─────────────────────────────────────────
  let overdueSortKey: keyof OverdueItem = "daysOverdue";
  let overdueSortDesc = true;

  function sortOverdue(items: OverdueItem[], key: keyof OverdueItem, desc: boolean): OverdueItem[] {
    return [...items].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return desc ? bVal - aVal : aVal - bVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return desc ? -cmp : cmp;
    });
  }

  function toggleOverdueSort(key: keyof OverdueItem) {
    if (overdueSortKey === key) {
      overdueSortDesc = !overdueSortDesc;
    } else {
      overdueSortKey = key;
      overdueSortDesc = true;
    }
  }

  // ─── Upcoming grouped by week ───────────────────────────────────
  function groupByWeek(items: ComplianceItem[]): { label: string; items: ComplianceItem[] }[] {
    const now = new Date();
    const groups: Map<string, ComplianceItem[]> = new Map();

    for (const item of items) {
      const due = new Date(item.dueDate);
      const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      let label: string;
      if (diffDays <= 7) label = "This Week";
      else if (diffDays <= 14) label = "Next Week";
      else if (diffDays <= 21) label = "In 2 Weeks";
      else label = "In 3-4 Weeks";

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(item);
    }

    const order = ["This Week", "Next Week", "In 2 Weeks", "In 3-4 Weeks"];
    return order
      .filter((l) => groups.has(l))
      .map((l) => ({ label: l, items: groups.get(l)! }));
  }

  function severityClass(item: ComplianceItem): string {
    const days = daysUntil(item.dueDate);
    if (days <= 3) return "border-l-4 border-l-red-500";
    if (days <= 7) return "border-l-4 border-l-amber-500";
    return "border-l-4 border-l-green-500";
  }

  // ─── Funding sorted by most critical ────────────────────────────
  $: sortedFunding = [...data.fundingStatus].sort(
    (a, b) => b.percentFunded - a.percentFunded,
  );

  // ─── Summary counts ─────────────────────────────────────────────
  $: ceilingAlertCount = data.fundingStatus.filter(
    (f) => f.percentFunded > 80,
  ).length;

  $: calDays = calendarDays(data.calendarYear, data.calendarMonth);
  $: weekGroups = groupByWeek(data.upcoming);
  $: sortedOverdueItems = sortOverdue(data.overdueItems, overdueSortKey, overdueSortDesc);

  // ─── Jira action ────────────────────────────────────────────────
  let jiraCreatedId: string | null = null;

  function createJiraTicket(item: OverdueItem) {
    jiraCreatedId = item.id;
  }
</script>

<div data-testid="compliance-page">
  <!-- ─── Summary Cards ──────────────────────────────────────────── -->
  <section class="mb-8" data-testid="summary-cards">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        data-testid="card-due-this-week"
      >
        <div class="text-sm font-medium text-gray-500">Due This Week</div>
        <div class="mt-2 text-3xl font-bold text-navy-900">
          {data.dueThisWeek.length}
        </div>
      </div>

      <div
        class="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm"
        data-testid="card-overdue"
      >
        <div class="text-sm font-medium text-red-600">Overdue Items</div>
        <div class="mt-2 text-3xl font-bold text-red-700">
          {data.overdueItems.length}
        </div>
      </div>

      <div
        class="rounded-lg border border-purple-200 bg-purple-50 p-5 shadow-sm"
        data-testid="card-option-windows"
      >
        <div class="text-sm font-medium text-purple-600">
          Option Windows (90d)
        </div>
        <div class="mt-2 text-3xl font-bold text-purple-700">
          {data.optionWindows.length}
        </div>
      </div>

      <div
        class="rounded-lg border border-orange-200 bg-orange-50 p-5 shadow-sm"
        data-testid="card-ceiling-alerts"
      >
        <div class="text-sm font-medium text-orange-600">
          Approaching Ceiling
        </div>
        <div class="mt-2 text-3xl font-bold text-orange-700">
          {ceilingAlertCount}
        </div>
      </div>
    </div>
  </section>

  <!-- ─── Calendar View ──────────────────────────────────────────── -->
  <section class="mb-8" data-testid="calendar-section">
    <div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-navy-900">
          {MONTH_NAMES[data.calendarMonth - 1]} {data.calendarYear}
        </h2>
        <div class="flex gap-2">
          <a
            href="?year={data.calendarMonth === 1 ? data.calendarYear - 1 : data.calendarYear}&month={data.calendarMonth === 1 ? 12 : data.calendarMonth - 1}"
            class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            &larr; Prev
          </a>
          <a
            href="?year={data.calendarMonth === 12 ? data.calendarYear + 1 : data.calendarYear}&month={data.calendarMonth === 12 ? 1 : data.calendarMonth + 1}"
            class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            Next &rarr;
          </a>
        </div>
      </div>

      <!-- Legend -->
      <div class="mb-3 flex gap-4 text-xs">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500"></span> Deliverables
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2.5 w-2.5 rounded-full bg-purple-500"></span> Options
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2.5 w-2.5 rounded-full bg-green-500"></span> Compliance
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2.5 w-2.5 rounded-full bg-orange-500"></span> Funding
        </span>
      </div>

      <!-- Calendar Grid -->
      <div class="grid grid-cols-7 gap-px bg-gray-200" data-testid="calendar-grid">
        {#each DAY_NAMES as dayName}
          <div class="bg-gray-50 px-2 py-1.5 text-center text-xs font-semibold text-gray-500">
            {dayName}
          </div>
        {/each}

        {#each calDays as cell}
          {@const cellDeadlines = deadlinesForDate(cell.dateStr)}
          <button
            class="min-h-[4rem] bg-white px-2 py-1 text-left transition-colors hover:bg-gray-50
              {!cell.inMonth ? 'text-gray-300' : 'text-gray-700'}
              {selectedDate === cell.dateStr ? 'ring-2 ring-navy-500' : ''}"
            on:click={() => { selectedDate = selectedDate === cell.dateStr ? null : cell.dateStr; }}
            data-testid="calendar-day"
            data-date={cell.dateStr}
          >
            <div class="text-sm font-medium">{cell.day}</div>
            {#if cellDeadlines.length > 0}
              <div class="mt-0.5 flex flex-wrap gap-0.5">
                {#each cellDeadlines.slice(0, 3) as dl}
                  <span
                    class="inline-block h-2 w-2 rounded-full {DEADLINE_TYPE_COLORS[dl.type] ?? 'bg-gray-400'}"
                    title="{dl.title} ({dl.contractNumber})"
                    data-testid="deadline-marker"
                  ></span>
                {/each}
                {#if cellDeadlines.length > 3}
                  <span class="text-[10px] text-gray-400">+{cellDeadlines.length - 3}</span>
                {/if}
              </div>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Selected date detail -->
      {#if selectedDate}
        {@const items = deadlinesForDate(selectedDate)}
        {#if items.length > 0}
          <div class="mt-4 rounded-lg border border-navy-200 bg-navy-50 p-4" data-testid="calendar-detail">
            <h3 class="mb-2 text-sm font-semibold text-navy-900">
              {formatDate(selectedDate)} — {items.length} item{items.length !== 1 ? "s" : ""}
            </h3>
            <div class="space-y-1">
              {#each items as item}
                <div class="flex items-center gap-2 text-sm" data-testid="calendar-detail-item">
                  <span class="inline-block h-2 w-2 rounded-full {DEADLINE_TYPE_COLORS[item.type] ?? 'bg-gray-400'}"></span>
                  <a href="/contracts/{item.contractId}" class="font-medium text-navy-800 hover:underline">
                    {item.contractNumber}
                  </a>
                  <span class="text-gray-600">{item.title}</span>
                  <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{item.type}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </section>

  <div class="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
    <!-- ─── Overdue Items Table ────────────────────────────────────── -->
    <section data-testid="overdue-section">
      <div class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div class="border-b border-gray-200 px-5 py-4">
          <h2 class="text-lg font-semibold text-red-700">
            Overdue Items ({data.overdueItems.length})
          </h2>
        </div>

        {#if data.overdueItems.length === 0}
          <div class="p-5 text-sm text-gray-400">No overdue items</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm" data-testid="overdue-table">
              <thead class="border-b border-gray-200 bg-gray-50">
                <tr>
                  {#each [
                    { key: "contractNumber", label: "Contract" },
                    { key: "itemType", label: "Type" },
                    { key: "description", label: "Description" },
                    { key: "dueDate", label: "Due Date" },
                    { key: "daysOverdue", label: "Days Overdue" },
                    { key: "responsibleParty", label: "Responsible" },
                    { key: "status", label: "Status" },
                  ] as col}
                    <th class="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                      <button
                        class="hover:text-navy-800"
                        on:click={() => toggleOverdueSort(col.key as keyof OverdueItem)}
                        data-testid="sort-{col.key}"
                      >
                        {col.label}
                        {#if overdueSortKey === col.key}
                          <span>{overdueSortDesc ? " \u25BC" : " \u25B2"}</span>
                        {/if}
                      </button>
                    </th>
                  {/each}
                  <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each sortedOverdueItems as item (item.id)}
                  <tr data-testid="overdue-row">
                    <td class="px-3 py-2.5">
                      <a href="/contracts/{item.contractId}" class="font-medium text-navy-800 hover:underline">
                        {item.contractNumber}
                      </a>
                    </td>
                    <td class="px-3 py-2.5 text-gray-600">{item.itemType}</td>
                    <td class="max-w-[200px] truncate px-3 py-2.5 text-gray-600">{item.description}</td>
                    <td class="px-3 py-2.5 text-gray-600">{formatDate(item.dueDate)}</td>
                    <td class="px-3 py-2.5">
                      <span class="font-semibold text-red-700" data-testid="days-overdue">
                        {item.daysOverdue}d
                      </span>
                    </td>
                    <td class="px-3 py-2.5 text-gray-600">{item.responsibleParty}</td>
                    <td class="px-3 py-2.5">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item.status)}">
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td class="px-3 py-2.5">
                      <button
                        class="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50
                          {jiraCreatedId === item.id ? 'border-green-300 bg-green-50 text-green-700' : ''}"
                        on:click={() => createJiraTicket(item)}
                        data-testid="jira-btn"
                      >
                        {jiraCreatedId === item.id ? "Ticket Created" : "Create Ticket"}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>

    <!-- ─── Upcoming Deadlines ─────────────────────────────────────── -->
    <section data-testid="upcoming-section">
      <div class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div class="border-b border-gray-200 px-5 py-4">
          <h2 class="text-lg font-semibold text-navy-900">
            Upcoming Deadlines (30 days)
          </h2>
        </div>

        {#if weekGroups.length === 0}
          <div class="p-5 text-sm text-gray-400">No upcoming deadlines</div>
        {:else}
          <div class="divide-y divide-gray-100">
            {#each weekGroups as group}
              <div data-testid="week-group">
                <div class="bg-gray-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500" data-testid="week-label">
                  {group.label} ({group.items.length})
                </div>
                {#each group.items as item (item.id)}
                  <div
                    class="flex items-center justify-between px-5 py-3 {severityClass(item)}"
                    data-testid="upcoming-item"
                  >
                    <div>
                      <span class="text-sm font-medium text-gray-900">{item.milestoneName}</span>
                      <span class="ml-2 text-xs text-gray-500">{item.contractNumber}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item.status)}">
                        {statusLabel(item.status)}
                      </span>
                      <span class="text-xs text-gray-500">{formatDate(item.dueDate)}</span>
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>

  <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
    <!-- ─── Funding Status Overview ────────────────────────────────── -->
    <section data-testid="funding-section">
      <div class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div class="border-b border-gray-200 px-5 py-4">
          <h2 class="text-lg font-semibold text-navy-900">Funding Status</h2>
        </div>

        {#if sortedFunding.length === 0}
          <div class="p-5 text-sm text-gray-400">No active contracts</div>
        {:else}
          <div class="divide-y divide-gray-100">
            {#each sortedFunding as fs (fs.contractId)}
              <div class="px-5 py-3" data-testid="funding-row">
                <div class="mb-1 flex items-center justify-between">
                  <a href="/contracts/{fs.contractId}" class="text-sm font-medium text-navy-800 hover:underline">
                    {fs.contractNumber}
                  </a>
                  <span class="text-xs text-gray-500">
                    {formatCurrency(fs.fundedValue)} / {formatCurrency(fs.ceilingValue)}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <div class="h-3 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <div
                      class="h-full rounded-full transition-all
                        {fs.percentFunded > 90 ? 'bg-red-500' :
                         fs.percentFunded > 80 ? 'bg-orange-500' :
                         fs.percentFunded > 60 ? 'bg-amber-400' :
                         'bg-green-500'}"
                      style="width: {Math.min(fs.percentFunded, 100)}%"
                      data-testid="funding-bar"
                    ></div>
                  </div>
                  <span
                    class="w-12 text-right text-xs font-semibold
                      {fs.percentFunded > 90 ? 'text-red-700' :
                       fs.percentFunded > 80 ? 'text-orange-700' :
                       'text-gray-700'}"
                    data-testid="funding-percent"
                  >
                    {fs.percentFunded}%
                  </span>
                </div>
                {#if fs.projectedRunout}
                  <div class="mt-1 text-xs text-gray-400">
                    Projected runout: {formatDate(fs.projectedRunout)}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- ─── Option Exercise Tracker ────────────────────────────────── -->
    <section data-testid="options-section">
      <div class="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div class="border-b border-gray-200 px-5 py-4">
          <h2 class="text-lg font-semibold text-navy-900">
            Option Exercise Tracker
          </h2>
        </div>

        {#if data.optionWindows.length === 0}
          <div class="p-5 text-sm text-gray-400">No upcoming option windows</div>
        {:else}
          <div class="divide-y divide-gray-100">
            {#each data.optionWindows as opt (opt.id)}
              {@const days = daysUntil(opt.exerciseDeadline)}
              <div class="px-5 py-3" data-testid="option-tracker-row">
                <div class="flex items-center justify-between">
                  <div>
                    <a href="/contracts/{opt.contractId}" class="text-sm font-medium text-navy-800 hover:underline">
                      {opt.contractNumber}
                    </a>
                    <span class="ml-2 text-xs text-gray-500">Option {opt.optionNumber}</span>
                  </div>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(opt.status)}"
                  >
                    {statusLabel(opt.status)}
                  </span>
                </div>
                <div class="mt-2 flex items-center justify-between">
                  <span class="text-xs text-gray-500">
                    Value: {formatCurrency(opt.optionValue)} — Deadline: {formatDate(opt.exerciseDeadline)}
                  </span>
                  <span
                    class="rounded px-2 py-0.5 text-xs font-semibold
                      {days < 0 ? 'bg-red-100 text-red-700' :
                       days <= 30 ? 'bg-amber-100 text-amber-700' :
                       'bg-green-100 text-green-700'}"
                    data-testid="option-countdown"
                  >
                    {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                  </span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>
