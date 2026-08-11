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
import { MrpiEnrichedWorkbookProvider, PublicGoogleSheetsMrpiProvider } from "../src/server/providers/mrpi.js";
import { PublicGoogleSheetsValuationProvider } from "../src/server/providers/valuation.js";
import {
  GoogleSheetsWorkbookProvider,
  PublicGoogleSheetsWorkbookProvider,
  UnavailableWorkbookProvider
} from "../src/server/providers/workbook.js";

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
const baseWorkbookProvider = config.googleSheets
  ? new GoogleSheetsWorkbookProvider(
      config.googleSheets.spreadsheetId,
      config.googleSheets.serviceAccountEmail,
      config.googleSheets.privateKey,
      config.googleSheetsCacheMs
    )
  : config.googleSheetsId
    ? new PublicGoogleSheetsWorkbookProvider(config.googleSheetsId, config.googleSheetsCacheMs)
    : new UnavailableWorkbookProvider(config.googleSheetsCacheMs);
const mrpiProvider = new PublicGoogleSheetsMrpiProvider(config.mrpiSheetsId, config.googleSheetsCacheMs);
const workbookProvider = new MrpiEnrichedWorkbookProvider(baseWorkbookProvider, mrpiProvider);
const valuationProvider = new PublicGoogleSheetsValuationProvider(config.valuationSheetsId, config.googleSheetsCacheMs);
const app = createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider });

export default function handler(request: VercelRequest, response: ServerResponse): void {
  const route = request.query?.path;
  const path = Array.isArray(route) ? route.join("/") : route;
  request.url = path ? `/api/${path}` : "/api";
  app(request, response);
}
