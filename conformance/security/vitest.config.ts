import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      BASE_URL: process.env.BASE_URL || "http://127.0.0.1:3000",
    },
  },
});
