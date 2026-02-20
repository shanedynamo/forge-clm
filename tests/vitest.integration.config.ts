import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@forge/agents": path.resolve(__dirname, "../packages/agents/src/index.ts"),
      "@forge/shared": path.resolve(__dirname, "../packages/shared/src/index.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
