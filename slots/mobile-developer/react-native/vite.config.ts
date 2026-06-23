import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * React Native, bundled for the web.
 *
 * The app source imports `react-native` and nothing else platform-specific.
 * The three settings below are what turn that into a web bundle, and they are
 * the whole of the platform story:
 *
 *   alias       `react-native` -> `react-native-web`, so `View`/`Text`/
 *               `Pressable`/`FlatList`/`StyleSheet` resolve to the DOM
 *               implementations. The real `react-native` package is never
 *               bundled: its sources are Flow-typed and would not parse.
 *   extensions  `.web.*` wins over the bare extension, which is how React
 *               Native's own platform-extension resolution works. This is what
 *               picks `@react-native-picker/picker`'s web implementation (a
 *               real `<select>`) over its native one.
 *   define      `__DEV__` is a React Native global; `global` is assumed by a
 *               few modules that predate ESM.
 *
 * `make run` and `make build` are both driven by $PORT so the harness can put
 * this app on any free port (3000, 5173 and 5400 are routinely taken).
 */
const port = Number(process.env.PORT ?? 5173);

const NATIVE_EXTENSIONS = [".web.tsx", ".web.ts", ".web.jsx", ".web.js"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "react-native": "react-native-web" },
    extensions: [...NATIVE_EXTENSIONS, ".tsx", ".ts", ".jsx", ".js", ".json"],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
    global: "globalThis",
  },
  optimizeDeps: {
    // Pre-bundling runs through esbuild, which does not read resolve.extensions
    // above, so the platform extensions have to be declared for it too.
    esbuildOptions: { resolveExtensions: [...NATIVE_EXTENSIONS, ".tsx", ".ts", ".jsx", ".js"] },
    include: ["react", "react-dom", "react-native-web", "@react-native-picker/picker"],
  },
  server: { host: "127.0.0.1", port, strictPort: true },
  preview: { host: "127.0.0.1", port, strictPort: true },
  build: {
    target: "es2020",
    sourcemap: false,
    reportCompressedSize: true,
  },
  test: {
    // The unit tests cover integer-cent arithmetic, which is pure: no renderer,
    // no DOM, and therefore no jsdom dependency to carry.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
