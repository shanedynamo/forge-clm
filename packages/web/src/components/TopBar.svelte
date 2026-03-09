<script lang="ts">
  import type { User } from "$lib/types.js";
  import { Menu, Bell, Settings } from "lucide-svelte";

  export let user: User;
  export let pageTitle: string = "Forge CLM";
  export let onToggleSidebar: (() => void) | undefined = undefined;
</script>

<header
  class="flex h-16 shrink-0 items-center justify-between border-b border-slate-300 bg-porcelain px-6"
  data-testid="topbar"
>
  <div class="flex items-center gap-4">
    {#if onToggleSidebar}
      <button
        class="rounded-full p-2 text-slate-500 hover:bg-slate-100 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 lg:hidden"
        on:click={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu class="h-5 w-5" strokeWidth={1.5} />
      </button>
    {/if}
    <h1 class="font-heading text-lg font-semibold text-slate-900">{pageTitle}</h1>
  </div>

  <!-- Breadcrumbs area (future use) -->
  <nav class="hidden font-body text-sm text-slate-700 lg:block" aria-label="Breadcrumb">
    <slot name="breadcrumbs" />
  </nav>

  <div class="flex items-center gap-4">
    <button
      class="relative rounded-full p-2 text-slate-500 hover:bg-slate-100 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
      aria-label="Notifications"
      data-testid="notifications-bell"
    >
      <Bell class="h-5 w-5" strokeWidth={1.5} />
    </button>

    <button
      class="rounded-full p-2 text-slate-500 hover:bg-slate-100 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
      aria-label="Settings"
      data-testid="settings-button"
    >
      <Settings class="h-5 w-5" strokeWidth={1.5} />
    </button>

    <div class="flex items-center gap-2" data-testid="user-info">
      <div
        class="flex h-8 w-8 items-center justify-center rounded-full bg-mahogany text-xs font-medium text-white"
        aria-hidden="true"
      >
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div class="hidden text-sm md:block">
        <div class="font-body font-medium text-slate-900">{user.name}</div>
        <div class="font-body text-xs text-slate-700">{user.role.replace(/_/g, " ")}</div>
      </div>
    </div>
  </div>
</header>
