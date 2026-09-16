import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the workflow sets BASE_PATH.
  base: process.env.BASE_PATH || "/",
  // Keep the wasm loader un-prebundled so its `new URL("openscad.wasm", import.meta.url)` resolves.
  optimizeDeps: { exclude: ["@lofcz/openscad-wasm"] },
  worker: { format: "es" },
});
