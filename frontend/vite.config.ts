import { defineConfig } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
