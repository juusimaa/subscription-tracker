import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A separate build keeps the deployed application and its absolute asset paths
// unchanged. Relative paths let GitHub Pages serve this under the repo prefix.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-ui",
    rollupOptions: { input: resolve(import.meta.dirname, "ui.html") },
  },
});
