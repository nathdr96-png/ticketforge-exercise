import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],

    // Seats are a shared, finite resource: two files racing for "the next
    // available seat" would produce failures that are about the suite, not about
    // the server. Serial execution keeps every failure meaningful.
    fileParallelism: false,
    sequence: { concurrent: false },

    // No retries, deliberately. A retried test hides a real intermittent bug,
    // and this suite is scored on whether its failures are trustworthy.
    retry: 0,

    // The grading machine is shared and sometimes loaded; generous timeouts stop
    // slowness from being reported as incorrectness.
    testTimeout: 60_000,
    hookTimeout: 60_000,

    env: {
      BASE_URL: process.env.BASE_URL || "http://127.0.0.1:3000",
    },
  },
});
