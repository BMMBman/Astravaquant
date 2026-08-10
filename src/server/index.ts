import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AstravaDatabase } from "./database.js";
import {
  CachedPortfolioProvider,
  GoldRushPortfolioProvider,
  UnavailablePortfolioProvider
} from "./providers/portfolio.js";

const config = loadConfig();
const database = new AstravaDatabase(config.databasePath);
const provider = config.goldrushApiKey
  ? new GoldRushPortfolioProvider(config.goldrushApiKey)
  : new UnavailablePortfolioProvider();
const portfolioProvider = new CachedPortfolioProvider(provider, config.portfolioCacheMs);
const app = createApp({ config, database, portfolioProvider });
database.cleanup();
const cleanupTimer = setInterval(() => database.cleanup(), 60 * 60 * 1000);
cleanupTimer.unref();

const server = app.listen(config.port, () => {
  console.log(`AstravaQuant API listening on port ${config.port}.`);
});

function shutdown(): void {
  clearInterval(cleanupTimer);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
