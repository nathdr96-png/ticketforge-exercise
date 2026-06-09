import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      // The directory the implementation under test wrote its predictions to.
      // No default: pointing this at the wrong place would grade a stale run.
      PREDICTIONS_DIR: process.env.PREDICTIONS_DIR || "",
    },
  },
});
