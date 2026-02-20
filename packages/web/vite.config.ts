import { sveltekit } from "@sveltejs/kit/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const isTest = !!process.env["VITEST"];

export default defineConfig({
  plugins: [isTest ? svelte({ hot: false }) : sveltekit()],
  resolve: {
    conditions: isTest ? ["browser"] : [],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    alias: [
      { find: "$lib", replacement: new URL("./src/lib", import.meta.url).pathname },
      { find: "$app/stores", replacement: new URL("./tests/mocks/app-stores.ts", import.meta.url).pathname },
      { find: "$app/forms", replacement: new URL("./tests/mocks/app-forms.ts", import.meta.url).pathname },
    ],
  },
});
