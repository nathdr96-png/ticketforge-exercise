import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      BASE_URL: process.env.BASE_URL || "http://127.0.0.1:3000",
      DATABASE_URL:
        process.env.DATABASE_URL ||
        "postgres://ticketforge:ticketforge@localhost:5432/ticketforge",
    },
  },
});
