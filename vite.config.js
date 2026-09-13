import { defineConfig } from "vite";

export default defineConfig({
  // Keep the wasm loader un-prebundled so its `new URL("openscad.wasm", import.meta.url)` resolves.
  optimizeDeps: { exclude: ["@lofcz/openscad-wasm"] },
  worker: { format: "es" },
});
