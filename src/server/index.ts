import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AstravaDatabase } from "./database.js";
import {
  CachedPortfolioProvider,
  GoldRushPortfolioProvider,
  UnavailablePortfolioProvider
} from "./providers/portfolio.js";
import { PublicMarketProvider } from "./providers/markets.js";
import { MrpiEnrichedWorkbookProvider, PublicGoogleSheetsMrpiProvider } from "./providers/mrpi.js";
import { PublicGoogleSheetsValuationProvider } from "./providers/valuation.js";
import {
  GoogleSheetsWorkbookProvider,
  PublicGoogleSheetsWorkbookProvider,
  UnavailableWorkbookProvider
} from "./providers/workbook.js";

const config = loadConfig();
const database = new AstravaDatabase(config.databasePath);
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
