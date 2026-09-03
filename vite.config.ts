import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        about: resolve(import.meta.dirname, "about.html"),
        archive: resolve(import.meta.dirname, "archive.html"),
        models: resolve(import.meta.dirname, "models.html"),
        valuation: resolve(import.meta.dirname, "valuation.html"),
        backtesting: resolve(import.meta.dirname, "backtesting.html"),
        trendFollowing: resolve(import.meta.dirname, "trend-following.html"),
        ltpiMethodology: resolve(import.meta.dirname, "ltpi-methodology.html"),
        mrpiMethodology: resolve(import.meta.dirname, "mrpi-methodology.html"),
        valuationMethodology: resolve(import.meta.dirname, "valuation-methodology.html"),
        terminal: resolve(import.meta.dirname, "terminal.html"),
        portfolio: resolve(import.meta.dirname, "portfolio.html"),
        signals: resolve(import.meta.dirname, "signals.html"),
        research: resolve(import.meta.dirname, "research.html"),
        researchCryptoParticipation: resolve(import.meta.dirname, "research-crypto-participation.html"),
        researchWeeklyStructure: resolve(import.meta.dirname, "research-weekly-structure.html"),
        researchMortgagePressure: resolve(import.meta.dirname, "research-mortgage-pressure.html"),
        methodology: resolve(import.meta.dirname, "methodology.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
        terms: resolve(import.meta.dirname, "terms.html")
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
