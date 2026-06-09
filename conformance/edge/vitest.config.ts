import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      // The directory the scanner under test wrote its decisions and state to.
      // No default: pointing this at the wrong place would grade stale output.
      SCAN_OUT_DIR: process.env.SCAN_OUT_DIR || "",
      // The device binary. Optional, and only a few checks need it — the ones
      // that have to feed the device input it has never seen.
      SCANNER_BIN: process.env.SCANNER_BIN || "",
    },
  },
});
