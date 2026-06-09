import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      // The directory the implementation under test rendered its deployment
      // configuration into. No default, for the same reason conformance/data
      // has none: silently grading the wrong directory — or a stale render —
      // is worse than refusing to run.
      RENDER_DIR: process.env.RENDER_DIR || "",
    },
  },
});
