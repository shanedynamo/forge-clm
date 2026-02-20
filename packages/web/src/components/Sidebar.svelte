<script lang="ts">
  import { getVisibleNavItems, type NavItem } from "$lib/auth.js";
  import type { AuthRole } from "$lib/types.js";

  export let role: AuthRole;
  export let currentPath: string = "/";
  export let open: boolean = true;

  $: navItems = getVisibleNavItems(role);

  const ICONS: Record<string, string> = {
    home: "H",
    "file-text": "C",
    "shield-check": "S",
    "git-branch": "B",
    inbox: "R",
    search: "Q",
    cpu: "A",
    "book-open": "P",
    "bar-chart-2": "R",
  };
</script>

<aside
  class="flex flex-col bg-navy-900 text-white transition-all duration-200 {open ? 'w-60' : 'w-16'}"
  data-testid="sidebar"
>
  <div class="flex h-16 items-center gap-3 border-b border-navy-700 px-4">
    <div class="flex h-8 w-8 items-center justify-center rounded bg-accent-500 text-sm font-bold">
      F
    </div>
    {#if open}
      <span class="text-sm font-semibold tracking-wide">Forge CLM</span>
    {/if}
  </div>

  <nav class="flex-1 overflow-y-auto py-4" data-testid="nav">
    {#each navItems as item (item.href)}
      <a
        href={item.href}
        class="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-navy-800
          {currentPath === item.href ? 'nav-link-active' : 'text-gray-300'}"
        data-testid="nav-link-{item.label.toLowerCase()}"
      >
        <span class="flex h-5 w-5 items-center justify-center text-xs font-medium">
          {ICONS[item.icon] ?? "?"}
        </span>
        {#if open}
          <span>{item.label}</span>
        {/if}
      </a>
    {/each}
  </nav>
</aside>
