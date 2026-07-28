import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Unit tests cover pure domain logic; database-touching code is exercised
    // by the Playwright suite against a real Postgres.
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
