<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import Sidebar from "../components/Sidebar.svelte";
  import TopBar from "../components/TopBar.svelte";
  import { NAV_ITEMS } from "$lib/auth.js";
  import type { User } from "$lib/types.js";

  export let data: { user: User | null; token: string | null };

  let sidebarOpen = true;

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }

  $: currentPath = $page.url.pathname;
  $: pageTitle =
    NAV_ITEMS.find((n) => n.href === currentPath)?.label ?? "Forge CLM";
</script>

{#if !data.user}
  <slot />
{:else}
  <div class="flex h-screen overflow-hidden">
    <Sidebar
      role={data.user.role}
      {currentPath}
      open={sidebarOpen}
    />

    <div class="flex flex-1 flex-col overflow-hidden">
      <TopBar
        user={data.user}
        {pageTitle}
        onToggleSidebar={toggleSidebar}
      />

      <main class="flex-1 overflow-y-auto p-6" data-testid="main-content">
        <slot />
      </main>
    </div>
  </div>
{/if}
