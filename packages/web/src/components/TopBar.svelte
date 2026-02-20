<script lang="ts">
  import type { User } from "$lib/types.js";

  export let user: User;
  export let pageTitle: string = "Forge CLM";
  export let onToggleSidebar: (() => void) | undefined = undefined;
</script>

<header
  class="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6"
  data-testid="topbar"
>
  <div class="flex items-center gap-4">
    {#if onToggleSidebar}
      <button
        class="rounded p-1 text-gray-500 hover:bg-gray-100 lg:hidden"
        on:click={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    {/if}
    <h1 class="text-lg font-semibold text-navy-900">{pageTitle}</h1>
  </div>

  <div class="flex items-center gap-4">
    <button
      class="relative rounded-full p-2 text-gray-500 hover:bg-gray-100"
      aria-label="Notifications"
      data-testid="notifications-bell"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    </button>

    <button
      class="rounded-full p-2 text-gray-500 hover:bg-gray-100"
      aria-label="Settings"
      data-testid="settings-button"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>

    <div class="flex items-center gap-2" data-testid="user-info">
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-navy-700 text-xs font-medium text-white">
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div class="hidden text-sm md:block">
        <div class="font-medium text-gray-900">{user.name}</div>
        <div class="text-xs text-gray-500">{user.role.replace(/_/g, " ")}</div>
      </div>
    </div>
  </div>
</header>
