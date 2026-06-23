import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// `make run` and `make build` are both driven by $PORT so the conformance
// harness can put this app on any free port (3000/5173 are routinely taken).
const port = Number(process.env.PORT ?? 5173);

export default defineConfig({
  plugins: [vue()],
  server: { host: "127.0.0.1", port, strictPort: true },
  preview: { host: "127.0.0.1", port, strictPort: true },
  build: {
    target: "es2020",
    sourcemap: false,
    reportCompressedSize: true,
  },
  test: {
    // The unit tests cover integer-cent arithmetic and formatting, which are
    // pure functions — no DOM, so no jsdom and no extra dependency weight.
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
