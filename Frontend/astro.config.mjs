import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [react(), tailwind()],
  output: "static",
  // Astro 3's esbuild minifier otherwise emits invalid `new Lib?.Api()`
  // syntax from the official React DataTables integration.
  vite: { esbuild: { supported: { "optional-chain": false } } },
});
