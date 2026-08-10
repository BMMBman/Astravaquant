import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { NeonAstravaDatabase } from "../src/server/neon-database.js";
import {
  CachedPortfolioProvider,
  GoldRushPortfolioProvider,
  UnavailablePortfolioProvider
} from "../src/server/providers/portfolio.js";
import { PublicMarketProvider } from "../src/server/providers/markets.js";

interface VercelRequest extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
}

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required for the AstravaQuant wallet service.");
}

const database = new NeonAstravaDatabase(config.databaseUrl);
const provider = config.goldrushApiKey
  ? new GoldRushPortfolioProvider(config.goldrushApiKey)
  : new UnavailablePortfolioProvider();
const portfolioProvider = new CachedPortfolioProvider(provider, config.portfolioCacheMs);
const marketProvider = new PublicMarketProvider(config.coinGeckoApiKey, config.marketCacheMs);
const app = createApp({ config, database, portfolioProvider, marketProvider });

export default function handler(request: VercelRequest, response: ServerResponse): void {
  const route = request.query?.path;
  const path = Array.isArray(route) ? route.join("/") : route;
  request.url = path ? `/api/${path}` : "/api";
  app(request, response);
}
