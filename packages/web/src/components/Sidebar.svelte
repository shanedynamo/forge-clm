<script lang="ts">
  import { getVisibleNavItems, type NavItem } from "$lib/auth.js";
  import type { AuthRole } from "$lib/types.js";
  import Home from "lucide-svelte/icons/home";
  import FileText from "lucide-svelte/icons/file-text";
  import ShieldCheck from "lucide-svelte/icons/shield-check";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Inbox from "lucide-svelte/icons/inbox";
  import Search from "lucide-svelte/icons/search";
  import Cpu from "lucide-svelte/icons/cpu";
  import BookOpen from "lucide-svelte/icons/book-open";
  import BarChart2 from "lucide-svelte/icons/bar-chart-2";
  import type { ComponentType } from "svelte";

  export let role: AuthRole;
  export let currentPath: string = "/";
  export let open: boolean = true;

  $: navItems = getVisibleNavItems(role);

  const ICONS: Record<string, ComponentType> = {
    home: Home,
    "file-text": FileText,
    "shield-check": ShieldCheck,
    "git-branch": GitBranch,
    inbox: Inbox,
    search: Search,
    cpu: Cpu,
    "book-open": BookOpen,
    "bar-chart-2": BarChart2,
  };
</script>

<aside
  class="flex flex-col bg-mahogany text-white transition-all duration-200 {open ? 'w-64' : 'w-16'}"
  data-testid="sidebar"
>
  <!-- Logo / brand header -->
  <div class="flex h-16 items-center gap-3 border-b border-black-cherry/30 px-4">
    <div class="flex h-8 w-8 items-center justify-center rounded bg-coral text-sm font-bold text-white">
      F
    </div>
    {#if open}
      <span class="font-heading text-sm font-semibold tracking-wide text-white">Forge CLM</span>
    {/if}
  </div>

  <!-- Navigation -->
  <nav class="flex-1 overflow-y-auto py-4" data-testid="nav">
    {#if open}
      <p class="px-4 pb-2 text-xs uppercase tracking-wider text-ash/60">Navigation</p>
    {/if}
    {#each navItems as item (item.href)}
      {@const isActive = currentPath === item.href}
      <a
        href={item.href}
        class="flex items-center gap-3 px-4 py-2.5 font-body text-sm text-white transition-colors duration-150
          {isActive ? 'nav-link-active' : 'hover:bg-black-cherry/10'}"
        data-testid="nav-link-{item.label.toLowerCase()}"
      >
        <span class="flex h-5 w-5 shrink-0 items-center justify-center">
          <svelte:component this={ICONS[item.icon]} class="h-5 w-5" strokeWidth={1.5} />
        </span>
        {#if open}
          <span>{item.label}</span>
        {/if}
      </a>
    {/each}
  </nav>

  <!-- Footer area -->
  <div class="border-t border-black-cherry/30 px-4 py-3">
    {#if open}
      <p class="text-xs text-ash/60">&copy; Dynamo Forge</p>
    {/if}
  </div>
</aside>
