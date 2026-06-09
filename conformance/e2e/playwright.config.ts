import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  // Every test in this suite shares one live backend and one seat inventory, so
  // they run one at a time. A parallel run would have two tests racing for the
  // same seat and reporting a conformance failure that is really a test bug.
  fullyParallel: false,
  workers: 1,
  // Generous: the 2,000-seat arena is 10 paginated requests plus 2,000 DOM nodes,
  // and this suite is also run on loaded CI machines.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.WEB_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
    // The contract states every timestamp is UTC (contract/errors.md). Pinning the
    // browser clock keeps hold-countdown assertions reproducible wherever this runs.
    timezoneId: "UTC",
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
