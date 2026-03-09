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
    if (days <= 3) return "border-l-4 border-l-danger";
    if (days <= 7) return "border-l-4 border-l-warning";
    return "border-l-4 border-l-success";
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

<div class="page-enter" data-testid="compliance-page">
  <!-- ─── Summary Cards (Pulse Strip) ──────────────────────────────── -->
  <section class="mb-8" data-testid="summary-cards">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        class="rounded-lg border border-slate-300 bg-white p-5 shadow-sm hover:shadow-md transition-shadow duration-200"
        data-testid="card-due-this-week"
      >
        <div class="font-body text-sm text-slate-700">Due This Week</div>
        <div class="mt-2 font-dramatic text-3xl font-bold text-slate-900">
          {data.dueThisWeek.length}
        </div>
      </div>

      <div
        class="rounded-lg border border-danger/30 bg-danger/5 p-5 shadow-sm hover:shadow-md transition-shadow duration-200"
        data-testid="card-overdue"
      >
        <div class="font-body text-sm text-danger">Overdue Items</div>
        <div class="mt-2 font-dramatic text-3xl font-bold text-danger">
          {data.overdueItems.length}
        </div>
      </div>

      <div
        class="rounded-lg border border-info/30 bg-info/5 p-5 shadow-sm hover:shadow-md transition-shadow duration-200"
        data-testid="card-option-windows"
      >
        <div class="font-body text-sm text-info">
          Option Windows (90d)
        </div>
        <div class="mt-2 font-dramatic text-3xl font-bold text-info">
          {data.optionWindows.length}
        </div>
      </div>

      <div
        class="rounded-lg border border-warning/30 bg-warning/5 p-5 shadow-sm hover:shadow-md transition-shadow duration-200"
        data-testid="card-ceiling-alerts"
      >
        <div class="font-body text-sm text-warning">
          Approaching Ceiling
        </div>
        <div class="mt-2 font-dramatic text-3xl font-bold text-warning">
          {ceilingAlertCount}
        </div>
      </div>
    </div>
  </section>

  <!-- ─── Calendar View ──────────────────────────────────────────── -->
  <section class="mb-8" data-testid="calendar-section">
    <div class="rounded-lg border border-slate-300 bg-white p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="font-heading font-semibold text-lg text-slate-900">
          {MONTH_NAMES[data.calendarMonth - 1]} {data.calendarYear}
        </h2>
        <div class="flex gap-2">
          <a
            href="?year={data.calendarMonth === 1 ? data.calendarYear - 1 : data.calendarYear}&month={data.calendarMonth === 1 ? 12 : data.calendarMonth - 1}"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-body hover:bg-slate-100 transition-all duration-150"
          >
            &larr; Prev
          </a>
          <a
            href="?year={data.calendarMonth === 12 ? data.calendarYear + 1 : data.calendarYear}&month={data.calendarMonth === 12 ? 1 : data.calendarMonth + 1}"
            class="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-body hover:bg-slate-100 transition-all duration-150"
          >
            Next &rarr;
          </a>
        </div>
      </div>

      <!-- Legend -->
      <div class="mb-3 flex gap-4 text-xs font-body">
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
      <div class="grid grid-cols-7 gap-px bg-slate-300" data-testid="calendar-grid">
        {#each DAY_NAMES as dayName}
          <div class="bg-slate-100 px-2 py-1.5 text-center font-heading text-xs font-semibold text-slate-700">
            {dayName}
          </div>
        {/each}

        {#each calDays as cell}
          {@const cellDeadlines = deadlinesForDate(cell.dateStr)}
          <button
            class="min-h-[4rem] bg-white px-2 py-1 text-left transition-colors hover:bg-slate-100
              {!cell.inMonth ? 'text-slate-300' : 'text-slate-700'}
              {selectedDate === cell.dateStr ? 'ring-2 ring-coral' : ''}"
            on:click={() => { selectedDate = selectedDate === cell.dateStr ? null : cell.dateStr; }}
            data-testid="calendar-day"
            data-date={cell.dateStr}
          >
            <div class="text-sm font-medium">{cell.day}</div>
            {#if cellDeadlines.length > 0}
              <div class="mt-0.5 flex flex-wrap gap-0.5">
                {#each cellDeadlines.slice(0, 3) as dl}
                  <span
                    class="inline-block h-2 w-2 rounded-full {DEADLINE_TYPE_COLORS[dl.type] ?? 'bg-slate-400'}"
                    title="{dl.title} ({dl.contractNumber})"
                    data-testid="deadline-marker"
                  ></span>
                {/each}
                {#if cellDeadlines.length > 3}
                  <span class="text-[10px] text-slate-400">+{cellDeadlines.length - 3}</span>
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
          <div class="mt-4 rounded-lg border border-coral/20 bg-coral-50 p-4" data-testid="calendar-detail">
            <h3 class="mb-2 font-heading text-sm font-semibold text-slate-900">
              {formatDate(selectedDate)} — {items.length} item{items.length !== 1 ? "s" : ""}
            </h3>
            <div class="space-y-1">
              {#each items as item}
                <div class="flex items-center gap-2 text-sm" data-testid="calendar-detail-item">
                  <span class="inline-block h-2 w-2 rounded-full {DEADLINE_TYPE_COLORS[item.type] ?? 'bg-slate-400'}"></span>
                  <a href="/contracts/{item.contractId}" class="font-medium text-coral hover:text-coral-700 hover:underline">
                    {item.contractNumber}
                  </a>
                  <span class="text-slate-600">{item.title}</span>
                  <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{item.type}</span>
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
      <div class="rounded-lg border border-slate-300 bg-white shadow-sm">
        <div class="border-b border-slate-200 px-5 py-4">
          <h2 class="font-heading font-semibold text-lg text-slate-900">
            Overdue Items ({data.overdueItems.length})
          </h2>
        </div>

        {#if data.overdueItems.length === 0}
          <div class="p-5 text-sm text-slate-400">No overdue items</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="dynamo-table w-full text-left text-sm" data-testid="overdue-table">
              <thead class="bg-slate-100">
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
                    <th class="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                      <button
                        class="hover:text-coral"
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
                  <th class="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                {#each sortedOverdueItems as item (item.id)}
                  <tr data-testid="overdue-row">
                    <td class="px-3 py-2.5">
                      <a href="/contracts/{item.contractId}" class="font-medium text-coral hover:text-coral-700 hover:underline">
                        {item.contractNumber}
                      </a>
                    </td>
                    <td class="px-3 py-2.5 text-slate-600">{item.itemType}</td>
                    <td class="max-w-[200px] truncate px-3 py-2.5 text-slate-600">{item.description}</td>
                    <td class="px-3 py-2.5 text-slate-600">{formatDate(item.dueDate)}</td>
                    <td class="px-3 py-2.5">
                      <span class="font-bold text-danger" data-testid="days-overdue">
                        {item.daysOverdue}d
                      </span>
                    </td>
                    <td class="px-3 py-2.5 text-slate-600">{item.responsibleParty}</td>
                    <td class="px-3 py-2.5">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item.status)}">
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td class="px-3 py-2.5">
                      <button
                        class="rounded border px-2 py-1 text-xs font-medium transition-all duration-150
                          {jiraCreatedId === item.id
                            ? 'border-success/30 bg-success/5 text-success'
                            : 'border-slate-300 text-slate-700 hover:bg-slate-100'}"
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
      <div class="rounded-lg border border-slate-300 bg-white shadow-sm">
        <div class="border-b border-slate-200 px-5 py-4">
          <h2 class="font-heading font-semibold text-lg text-slate-900">
            Upcoming Deadlines (30 days)
          </h2>
        </div>

        {#if weekGroups.length === 0}
          <div class="p-5 text-sm text-slate-400">No upcoming deadlines</div>
        {:else}
          <div class="divide-y divide-slate-100">
            {#each weekGroups as group}
              <div data-testid="week-group">
                <div class="bg-slate-100 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 font-heading" data-testid="week-label">
                  {group.label} ({group.items.length})
                </div>
                {#each group.items as item (item.id)}
                  <div
                    class="flex items-center justify-between px-5 py-3 {severityClass(item)}"
                    data-testid="upcoming-item"
                  >
                    <div>
                      <span class="text-sm font-medium text-slate-900">{item.milestoneName}</span>
                      <span class="ml-2 text-xs text-slate-500">{item.contractNumber}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item.status)}">
                        {statusLabel(item.status)}
                      </span>
                      <span class="font-mono text-xs text-slate-700">{formatDate(item.dueDate)}</span>
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
      <div class="rounded-lg border border-slate-300 bg-white shadow-sm">
        <div class="border-b border-slate-200 px-5 py-4">
          <h2 class="font-heading font-semibold text-lg text-slate-900">Funding Status</h2>
        </div>

        {#if sortedFunding.length === 0}
          <div class="p-5 text-sm text-slate-400">No active contracts</div>
        {:else}
          <div class="divide-y divide-slate-100">
            {#each sortedFunding as fs (fs.contractId)}
              <div class="px-5 py-3" data-testid="funding-row">
                <div class="mb-1 flex items-center justify-between">
                  <a href="/contracts/{fs.contractId}" class="text-sm font-medium text-coral hover:text-coral-700 hover:underline">
                    {fs.contractNumber}
                  </a>
                  <span class="text-xs text-slate-500">
                    {formatCurrency(fs.fundedValue)} / {formatCurrency(fs.ceilingValue)}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <div class="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      class="h-full rounded-full transition-all
                        {fs.percentFunded > 90 ? 'bg-danger' :
                         fs.percentFunded > 80 ? 'bg-warning' :
                         fs.percentFunded > 60 ? 'bg-amber-400' :
                         'bg-success'}"
                      style="width: {Math.min(fs.percentFunded, 100)}%"
                      data-testid="funding-bar"
                    ></div>
                  </div>
                  <span
                    class="w-12 text-right text-xs font-semibold font-mono
                      {fs.percentFunded > 90 ? 'text-danger' :
                       fs.percentFunded > 80 ? 'text-warning' :
                       'text-slate-700'}"
                    data-testid="funding-percent"
                  >
                    {fs.percentFunded}%
                  </span>
                </div>
                {#if fs.projectedRunout}
                  <div class="mt-1 text-xs font-mono text-slate-500">
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
      <div class="rounded-lg border border-slate-300 bg-white shadow-sm">
        <div class="border-b border-slate-200 px-5 py-4">
          <h2 class="font-heading font-semibold text-lg text-slate-900">
            Option Exercise Tracker
          </h2>
        </div>

        {#if data.optionWindows.length === 0}
          <div class="p-5 text-sm text-slate-400">No upcoming option windows</div>
        {:else}
          <div class="divide-y divide-slate-100">
            {#each data.optionWindows as opt (opt.id)}
              {@const days = daysUntil(opt.exerciseDeadline)}
              <div class="px-5 py-3" data-testid="option-tracker-row">
                <div class="flex items-center justify-between">
                  <div>
                    <a href="/contracts/{opt.contractId}" class="text-sm font-medium text-coral hover:text-coral-700 hover:underline">
                      {opt.contractNumber}
                    </a>
                    <span class="ml-2 text-xs text-slate-500">Option {opt.optionNumber}</span>
                  </div>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColor(opt.status)}"
                  >
                    {statusLabel(opt.status)}
                  </span>
                </div>
                <div class="mt-2 flex items-center justify-between">
                  <span class="text-xs text-slate-500">
                    Value: <span class="font-mono">{formatCurrency(opt.optionValue)}</span> — Deadline: <span class="font-mono">{formatDate(opt.exerciseDeadline)}</span>
                  </span>
                  <span
                    class="rounded-full px-2.5 py-0.5 text-xs font-medium font-mono
                      {days < 0 ? 'bg-danger/10 text-danger' :
                       days <= 30 ? 'bg-warning/10 text-warning' :
                       'bg-success/10 text-success'}"
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
