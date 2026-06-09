import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      // The directory the implementation under test wrote its answers to.
      // No default: pointing this at the wrong place would grade stale files.
      RESULTS_DIR: process.env.RESULTS_DIR || "",
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgres://ticketforge:ticketforge@localhost:5432/ticketforge",
    },
  },
});
