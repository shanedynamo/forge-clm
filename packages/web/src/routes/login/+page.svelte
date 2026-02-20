<script lang="ts">
  import { enhance } from "$app/forms";

  let email = "developer@dynamo.com";
  let error = "";
</script>

<div class="flex min-h-screen items-center justify-center bg-navy-950">
  <div class="w-full max-w-md rounded-lg bg-white p-8 shadow-xl">
    <!-- Logo -->
    <div class="mb-8 text-center">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-accent-500 text-xl font-bold text-white">
        F
      </div>
      <h1 class="text-2xl font-bold text-navy-900">Forge CLM</h1>
      <p class="mt-1 text-sm text-gray-500">Federal Contract Lifecycle Management</p>
    </div>

    {#if error}
      <div class="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
    {/if}

    <form method="POST" use:enhance>
      <div class="mb-4">
        <label for="email" class="mb-1 block text-sm font-medium text-gray-700">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          bind:value={email}
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          required
        />
      </div>

      <div class="mb-4">
        <label for="password" class="mb-1 block text-sm font-medium text-gray-700">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value="dev-password"
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          required
        />
      </div>

      <div class="mb-4">
        <label for="role" class="mb-1 block text-sm font-medium text-gray-700">Role (Dev)</label>
        <select
          id="role"
          name="role"
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          <option value="admin">Admin</option>
          <option value="contracts_manager">Contracts Manager</option>
          <option value="contracts_team">Contracts Team</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      <button
        type="submit"
        class="w-full rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2"
      >
        Sign In
      </button>
    </form>

    <p class="mt-6 text-center text-xs text-gray-400">
      Dynamo Technologies, Inc. — Local Development
    </p>
  </div>
</div>
