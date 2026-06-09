import { defineConfig } from "vitest/config";

/**
 * The security family's config: the four original assertions PLUS the hardening
 * ones in `hardening.security-test.ts`.
 *
 * Two configs live side by side in this directory and only one of them can see
 * the hardening file:
 *
 *   vitest.config.ts            default include — `*.test.ts`   → security.test.ts
 *   vitest.hardening.config.ts  `security.test.ts` + `*.security-test.ts`
 *
 * `hardening.security-test.ts` ends in `-test.ts`, not `.test.ts`, so the
 * default include does not match it. A bare `npx vitest run` here therefore
 * collects exactly the four tests it always did, and every backend is graded
 * by this directory exactly as it was before the hardening tests arrived.
 *
 * The security family runs this directory with `--config
 * vitest.hardening.config.ts` instead of the default, so it is graded on both
 * halves in one suite: the four
 * assertions every backend must satisfy, and the hardening assertions this
 * family exists for. They are one suite deliberately — "did you keep the
 * original four green while closing the hole" is the question, so splitting
 * them into two numbers would invite answering only one.
 *
 * Run it by hand with:
 *   BASE_URL=http://127.0.0.1:3100 npx vitest run --config vitest.hardening.config.ts
 */
export default defineConfig({
  test: {
    include: ["security.test.ts", "*.security-test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      BASE_URL: process.env.BASE_URL || "http://127.0.0.1:3000",
    },
  },
});
