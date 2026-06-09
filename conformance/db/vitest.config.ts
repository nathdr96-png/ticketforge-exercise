import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgres://ticketforge:ticketforge@localhost:5432/ticketforge",
    },
  },
});
