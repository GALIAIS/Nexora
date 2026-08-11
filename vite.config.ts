import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4100",
      "/socket": {
        target: "ws://127.0.0.1:4100",
        ws: true
      }
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
