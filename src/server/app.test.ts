import request from "supertest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { createApp } from "./app.js";
import { AstravaDatabase } from "./database.js";
import type { PortfolioProvider } from "./providers/portfolio.js";

const origin = "http://localhost:5173";
const mutationHeaders = { Origin: origin, "X-Astrava-Request": "wallet-auth" };

const config: AppConfig = {
  nodeEnv: "test",
  port: 3000,
  appUrl: new URL(`${origin}/`),
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  sessionTtlMs: 60 * 60 * 1000,
  databasePath: ":memory:",
  databaseUrl: null,
  walletConnectProjectId: null,
  goldrushApiKey: null,
  portfolioCacheMs: 60_000,
  coinGeckoApiKey: null,
  marketCacheMs: 300_000,
  googleSheets: null,
  googleSheetsId: "1biKNqqaBGKRYYFgJ8ND-DozvwD7R9h9_r4B5YXeRYzA",
  valuationSheetsId: "1CDRiyNvMiQEz-YsrJT6vOEPN-CwAMj6cQrMYmY01bxE",
  googleSheetsCacheMs: 300_000,
  rpcUrls: { 1: undefined, 8453: undefined, 42161: undefined }
};

const marketProvider = {
  async getDashboard() {
    return { status: "unavailable" as const, updatedAt: new Date().toISOString(), metrics: [] };
  }
};

const workbookProvider = {
  async getDashboard() {
    return {
      status: "not_configured" as const,
      provider: null,
      updatedAt: new Date().toISOString(),
      refreshSeconds: 300,
      signals: [
        {
          id: "mtpi",
          name: "Medium-Term Trend",
          value: 0.47,
          state: "LONG",
          regime: "CONSTRUCTIVE EXPANSION",
          scope: "Five-day aggregate.",
          relevantSymbols: ["ETH"],
          source: "manual_fallback" as const,
          sourceTab: null,
          updatedLabel: null
        },
        {
          id: "nspi",
          name: "NSPI",
          value: -0.24,
          state: "NEUTRAL TRANSITION",
          regime: "NEUTRAL TRANSITION",
          scope: "Aggregate regime.",
          relevantSymbols: ["ETH"],
          source: "manual_fallback" as const,
          sourceTab: null,
          updatedLabel: null
        }
      ],
      scoreSeries: [],
      ratioModels: [],
      tabs: [],
      warnings: []
    };
  }
};

const valuationProvider = {
  async getDashboard() {
    return {
      status: "ready" as const,
      provider: "Google Sheets" as const,
      updatedAt: new Date().toISOString(),
      refreshSeconds: 300,
      workbookUpdatedLabel: "Dec 22 2025",
      sourceUrl: "https://docs.google.com/spreadsheets/d/test/edit",
      score: 1.84,
      calculatedScore: 1.835,
      invertedScore: -1.84,
      state: "High Value",
      invertedState: "No Value",
      scaleMin: -2,
      scaleMax: 2,
      indicatorCount: 17,
      indicators: [],
      categories: [],
      historyStatus: "unavailable" as const,
      historyMessage: "No verified history.",
      history: [],
      warnings: []
    };
  }
};

const portfolioProvider: PortfolioProvider = {
  name: "Test indexer",
  async getPortfolio(address, chain) {
    return {
      status: "ready",
      message: null,
      provider: "Test indexer",
      address,
      chainId: chain.id,
      network: chain.name,
      asOf: new Date().toISOString(),
      totalValueUsd: 2500,
      assetCount: 1,
      change24hPct: null,
      change24hUsd: null,
      holdings: [
        {
          symbol: "ETH",
          name: "Ether",
          contractAddress: "native",
          balance: "1",
          priceUsd: 2500,
          valueUsd: 2500,
          allocationPct: 100,
          change24hPct: null,
          logoUrl: null
        }
      ]
    };
  }
};

describe("wallet authentication", () => {
  let database: AstravaDatabase;

  beforeEach(() => {
    database = new AstravaDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  async function authenticate() {
    const account = privateKeyToAccount(generatePrivateKey());
    const agent = request.agent(createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider }));
    const nonceResponse = await agent
      .post("/api/auth/nonce")
      .set(mutationHeaders)
      .send({ address: account.address, chainId: 1 })
      .expect(201);
    const message = nonceResponse.body.message as string;
    const signature = await account.signMessage({ message });
    const verification = await agent
      .post("/api/auth/verify")
      .set(mutationHeaders)
      .send({ message, signature })
      .expect(200);
    return { account, agent, message, signature, verification };
  }

  it("reports the wallet API as healthy when its datastore is available", async () => {
    const response = await request(createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider }))
      .get("/api/health")
      .expect(200);
    expect(response.body).toEqual({ status: "ok", service: "astravaquant-wallet" });
  });

  it("creates a server session after a valid SIWE signature", async () => {
    const { account, agent, verification } = await authenticate();
    expect(verification.body).toMatchObject({
      authenticated: true,
      address: account.address,
      chainId: 1,
      network: "Ethereum",
      accessTier: "authenticated"
    });
    expect(verification.headers["set-cookie"]?.[0]).toContain("aq_session=");
    expect(verification.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const session = await agent.get("/api/auth/session").expect(200);
    expect(session.body.authenticated).toBe(true);
  });

  it("rejects nonce replay", async () => {
    const { agent, message, signature } = await authenticate();
    const replay = await agent
      .post("/api/auth/verify")
      .set(mutationHeaders)
      .send({ message, signature })
      .expect(401);
    expect(replay.body.error.code).toBe("AUTH_MESSAGE_EXPIRED");
  });

  it("rejects authentication requests from another origin", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const app = createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider });
    const response = await request(app)
      .post("/api/auth/nonce")
      .set({ Origin: "https://example.com", "X-Astrava-Request": "wallet-auth" })
      .send({ address: account.address, chainId: 1 })
      .expect(403);
    expect(response.body.error.code).toBe("UNTRUSTED_ORIGIN");
  });

  it("requires authentication for portfolio data and revokes logout sessions", async () => {
    const app = createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider });
    await request(app).get("/api/dashboard").expect(401);

    const { agent } = await authenticate();
    const dashboard = await agent.get("/api/dashboard").expect(200);
    expect(dashboard.body.portfolio.totalValueUsd).toBe(2500);
    expect(dashboard.body.signals.map((signal: { id: string }) => signal.id)).toContain("mtpi");
    expect(dashboard.body.allocationContext.status).toBe("unpublished");

    await agent.post("/api/auth/logout").set(mutationHeaders).send({}).expect(200);
    await agent.get("/api/dashboard").expect(401);
  });

  it("publishes the normalized workbook contract without authentication", async () => {
    const response = await request(createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider }))
      .get("/api/workbook")
      .expect(200);
    expect(response.body.status).toBe("not_configured");
    expect(response.body.signals[0].id).toBe("mtpi");
  });

  it("publishes the Bitcoin valuation contract without authentication", async () => {
    const response = await request(createApp({ config, database, portfolioProvider, marketProvider, workbookProvider, valuationProvider }))
      .get("/api/valuation")
      .expect(200);
    expect(response.body.score).toBe(1.84);
    expect(response.body.state).toBe("High Value");
  });
});
