import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { MarketDashboard, PortfolioDashboard, PortfolioOverview, WorkbookDashboard } from "../shared/contracts.js";
import { attachSession, createAuthRouter, requireAuth, sessionResponse } from "./auth.js";
import { getSupportedChain, supportedChains, type AppConfig } from "./config.js";
import type { AstravaDataStore } from "./database.js";
import type { PortfolioProvider } from "./providers/portfolio.js";
import { PortfolioProviderError } from "./providers/portfolio.js";
import type { PublicMarketProvider } from "./providers/markets.js";
import type { WorkbookProvider } from "./providers/workbook.js";
import { workbookSignals } from "./providers/workbook.js";
import { ApiError } from "./security.js";
import { buildAllPerformanceSeries } from "./services/performance.js";
import {
  allocationContext,
  portfolioRegime,
  relevantResearch,
  relevantSignals
} from "./services/personalization.js";

interface AppDependencies {
  config: AppConfig;
  database: AstravaDataStore;
  portfolioProvider: PortfolioProvider;
  marketProvider: Pick<PublicMarketProvider, "getDashboard">;
  workbookProvider: WorkbookProvider;
}
function unavailablePortfolio(address: string, chainId: number, network: string): PortfolioOverview {
  return {
    status: "unavailable",
    message: "Portfolio data is temporarily unavailable. Your wallet remains connected and no asset access was requested.",
    provider: null,
    address,
    chainId,
    network,
    asOf: null,
    totalValueUsd: null,
    assetCount: 0,
    change24hPct: null,
    change24hUsd: null,
    holdings: []
  };
}

export function createApp({ config, database, portfolioProvider, marketProvider, workbookProvider }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:", "wss:"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.nodeEnv === "production" ? [] : null
        }
      },
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
    })
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  app.use(attachSession(config, database));

  const apiRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment." } }
  });
  app.use("/api", apiRateLimit);

  app.get("/api/config", (_request, response) => {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.json({
      walletConnectProjectId: config.walletConnectProjectId,
      supportedChains: supportedChains.map(({ id, name, shortName }) => ({ id, name, shortName })),
      readOnlyNotice: "Wallet access is read-only and non-custodial. AstravaQuant never requests transaction approval."
    });
  });

  app.get("/api/health", async (_request, response, next) => {
    try {
      await database.cleanup();
      response.setHeader("Cache-Control", "no-store");
      response.json({ status: "ok", service: "astravaquant-wallet" });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/auth", createAuthRouter(config, database));

  app.get("/api/markets", async (_request, response, next) => {
    try {
      const dashboard: MarketDashboard = await marketProvider.getDashboard();
      response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
      response.json(dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workbook", async (_request, response, next) => {
    try {
      const dashboard: WorkbookDashboard = await workbookProvider.getDashboard();
      response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
      response.json(dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard", requireAuth, async (request, response, next) => {
    try {
      const session = request.astravaSession!;
      const chain = getSupportedChain(session.chainId);
      if (!chain) {
        throw new ApiError(400, "UNSUPPORTED_NETWORK", "The authenticated network is no longer supported.");
      }

      let portfolio: PortfolioOverview;
      try {
        portfolio = await portfolioProvider.getPortfolio(session.address as `0x${string}`, chain);
      } catch (error) {
        if (!(error instanceof PortfolioProviderError)) {
          throw error;
        }
        portfolio = unavailablePortfolio(session.address, chain.id, chain.name);
      }

      if (portfolio.status === "ready" && portfolio.totalValueUsd !== null) {
        await database.recordSnapshot({
          walletId: session.walletId,
          chainId: chain.id,
          totalValueUsd: portfolio.totalValueUsd,
          minimumIntervalMs: 15 * 60 * 1000
        });
      }

      const snapshots = await database.getSnapshots(session.walletId, chain.id);
      const modelSignals = workbookSignals(await workbookProvider.getDashboard());
      const dashboard: PortfolioDashboard = {
        session: sessionResponse(request),
        portfolio,
        performance: buildAllPerformanceSeries(snapshots),
        portfolioRegime: portfolioRegime(modelSignals),
        signals: relevantSignals(portfolio.holdings, modelSignals),
        research: relevantResearch(portfolio.holdings),
        allocationContext: allocationContext(portfolio.holdings)
      };
      response.setHeader("Cache-Control", "no-store");
      response.json(dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_request, _response, next) => {
    next(new ApiError(404, "API_NOT_FOUND", "This AstravaQuant API route does not exist."));
  });

  const staticDirectory = resolve("dist");
  if (existsSync(staticDirectory)) {
    app.use(express.static(staticDirectory, { index: "index.html", extensions: ["html"] }));
    for (const page of [
      "models",
      "backtesting",
      "terminal",
      "portfolio",
      "signals",
      "research",
      "research-crypto-participation",
      "research-weekly-structure",
      "research-mortgage-pressure",
      "methodology",
      "privacy",
      "terms"
    ]) {
      app.get(`/${page}`, (_request, response) => response.sendFile(resolve(staticDirectory, `${page}.html`)));
    }
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }

    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "AstravaQuant could not complete this request. Please try again."
      }
    });
  };
  app.use(errorHandler);

  return app;
}
