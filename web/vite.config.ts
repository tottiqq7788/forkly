import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Keep runtime on the vendored package even though tsc uses a type shim via paths.
    alias: {
      "@muyajs/core": path.resolve(__dirname, "../third_party/muya/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/local-api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "../internal/webui/dist",
    emptyOutDir: true,
  },
});
