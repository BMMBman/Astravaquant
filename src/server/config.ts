import "dotenv/config";
import { z } from "zod";
import type { SupportedChain } from "../shared/contracts.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  DATABASE_PATH: z.string().min(1).default("./data/astravaquant.db"),
  WALLETCONNECT_PROJECT_ID: z.string().min(1).optional(),
  GOLDRUSH_API_KEY: z.string().min(1).optional(),
  PORTFOLIO_CACHE_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  ETHEREUM_RPC_URL: z.url().optional(),
  BASE_RPC_URL: z.url().optional(),
  ARBITRUM_RPC_URL: z.url().optional()
});

export const supportedChains: SupportedChain[] = [
  { id: 1, name: "Ethereum", shortName: "ETH", providerSlug: "eth-mainnet" },
  { id: 8453, name: "Base", shortName: "BASE", providerSlug: "base-mainnet" },
  { id: 42161, name: "Arbitrum", shortName: "ARB", providerSlug: "arbitrum-mainnet" }
];

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  appUrl: URL;
  sessionSecret: string;
  sessionTtlMs: number;
  databasePath: string;
  walletConnectProjectId: string | null;
  goldrushApiKey: string | null;
  portfolioCacheMs: number;
  rpcUrls: Record<number, string | undefined>;
}
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(environment);
  const sessionSecret = parsed.SESSION_SECRET ?? "astravaquant-development-secret-only";

  if (parsed.NODE_ENV === "production" && !parsed.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production.");
  }

  if (parsed.NODE_ENV === "production" && parsed.APP_URL.startsWith("http://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appUrl: new URL(parsed.APP_URL),
    sessionSecret,
    sessionTtlMs: parsed.SESSION_TTL_HOURS * 60 * 60 * 1000,
    databasePath: parsed.DATABASE_PATH,
    walletConnectProjectId: parsed.WALLETCONNECT_PROJECT_ID ?? null,
    goldrushApiKey: parsed.GOLDRUSH_API_KEY ?? null,
    portfolioCacheMs: parsed.PORTFOLIO_CACHE_SECONDS * 1000,
    rpcUrls: {
      1: parsed.ETHEREUM_RPC_URL,
      8453: parsed.BASE_RPC_URL,
      42161: parsed.ARBITRUM_RPC_URL
    }
  };
}

export function getSupportedChain(chainId: number): SupportedChain | undefined {
  return supportedChains.find((chain) => chain.id === chainId);
}
