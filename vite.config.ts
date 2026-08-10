import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        models: resolve(import.meta.dirname, "models.html"),
        terminal: resolve(import.meta.dirname, "terminal.html"),
        portfolio: resolve(import.meta.dirname, "portfolio.html")
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000"
    }
  }
});
