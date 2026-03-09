<script lang="ts">
  import { enhance } from "$app/forms";

  let email = "developer@dynamo.com";
  let error = "";
</script>

<div class="flex min-h-screen items-center justify-center bg-mahogany">
  <div class="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
    <!-- Logo -->
    <div class="mb-8 text-center">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-coral text-xl font-bold text-white">
        F
      </div>
      <h1 class="font-heading text-2xl font-bold text-slate-900">Forge CLM</h1>
      <p class="mt-1 font-body text-sm text-slate-500">Federal Contract Lifecycle Management</p>
    </div>

    {#if error}
      <div class="mb-4 rounded-lg bg-danger/5 p-3 font-body text-sm text-danger">{error}</div>
    {/if}

    <form method="POST" use:enhance>
      <div class="mb-4">
        <label for="email" class="mb-1 block font-body text-sm font-medium text-slate-700">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          bind:value={email}
          class="h-10 w-full rounded-lg border border-slate-300 px-3 py-2 font-body text-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/50"
          required
        />
      </div>

      <div class="mb-4">
        <label for="password" class="mb-1 block font-body text-sm font-medium text-slate-700">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value="dev-password"
          class="h-10 w-full rounded-lg border border-slate-300 px-3 py-2 font-body text-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/50"
          required
        />
      </div>

      <div class="mb-4">
        <label for="role" class="mb-1 block font-body text-sm font-medium text-slate-700">Role (Dev)</label>
        <select
          id="role"
          name="role"
          class="h-10 w-full rounded-lg border border-slate-300 px-3 py-2 font-body text-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/50"
        >
          <option value="admin">Admin</option>
          <option value="contracts_manager">Contracts Manager</option>
          <option value="contracts_team">Contracts Team</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      <button
        type="submit"
        class="w-full rounded-lg bg-coral px-4 py-2 font-body text-sm font-medium text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
      >
        Sign In
      </button>
    </form>

    <p class="mt-6 text-center font-body text-xs text-slate-400">
      Dynamo Technologies, Inc. — Local Development
    </p>
  </div>
</div>
