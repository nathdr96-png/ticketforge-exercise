import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One chain, driven by one file at a time. Two test files replaying a
    // deployment onto the same node concurrently would each reset the other's
    // state, and the failures would look like contract bugs.
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
    globalSetup: ["./globalSetup.ts"],
    env: {
      // The deployment the implementation under test declared.
      // No default: a default would silently grade a stale file, or somebody
      // else's chain.
      CHAIN_DEPLOYMENT: process.env.CHAIN_DEPLOYMENT || "",
      // The seed for the property/invariant runner. Pinned so a failure is
      // reproducible and a pass is not luck.
      CHAIN_FUZZ_SEED: process.env.CHAIN_FUZZ_SEED || "20260108",
      CHAIN_FUZZ_RUNS: process.env.CHAIN_FUZZ_RUNS || "15",
    },
  },
});
