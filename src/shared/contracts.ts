export type AccessTier = "public" | "authenticated" | "premium";

export interface SupportedChain {
  id: number;
  name: string;
  shortName: string;
  providerSlug: string;
}
export interface PublicConfig {
  walletConnectProjectId: string | null;
  supportedChains: Array<Pick<SupportedChain, "id" | "name" | "shortName">>;
  readOnlyNotice: string;
}

export interface AuthSession {
  authenticated: boolean;
  address: string | null;
  chainId: number | null;
  network: string | null;
  accessTier: AccessTier;
  expiresAt: string | null;
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  contractAddress: string;
  balance: string;
  priceUsd: number | null;
  valueUsd: number | null;
  allocationPct: number | null;
  change24hPct: number | null;
  logoUrl: string | null;
}

export interface PortfolioOverview {
  status: "ready" | "empty" | "unavailable";
  message: string | null;
  provider: string | null;
  address: string;
  chainId: number;
  network: string;
  asOf: string | null;
  totalValueUsd: number | null;
  assetCount: number;
  change24hPct: number | null;
  change24hUsd: number | null;
  holdings: PortfolioHolding[];
}

export type PerformancePeriod = "1D" | "7D" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

export interface PerformancePoint {
  timestamp: string;
  valueUsd: number;
}

export interface PerformanceSeries {
  period: PerformancePeriod;
  status: "ready" | "insufficient_history";
  message: string | null;
  startValueUsd: number | null;
  endValueUsd: number | null;
  changeUsd: number | null;
  changePct: number | null;
  points: PerformancePoint[];
}

export interface ModelSignal {
  id: string;
  name: string;
  value: number;
  state: string;
  scope: string;
  relevantSymbols: string[];
}

export interface PersonalizedResearch {
  id: string;
  title: string;
  summary: string;
  href: string;
  symbols: string[];
  relevance: number;
}

export interface AllocationContext {
  status: "ready" | "unpublished";
  message: string;
  portfolio: Array<{ symbol: string; allocationPct: number }>;
  model: Array<{ symbol: string; allocationPct: number }>;
  differences: Array<{ symbol: string; differencePct: number }>;
}

export interface PortfolioDashboard {
  session: AuthSession;
  portfolio: PortfolioOverview;
  performance: Record<PerformancePeriod, PerformanceSeries>;
  portfolioRegime: ModelSignal;
  signals: ModelSignal[];
  research: PersonalizedResearch[];
  allocationContext: AllocationContext;
}

export type MarketMetricId =
  | "total"
  | "total2"
  | "bitcoin"
  | "ethereum"
  | "treasury10y"
  | "fedLiquidity"
  | "mortgage30y"
  | "homePrices";

export interface MarketPoint {
  timestamp: string;
  value: number;
}

export interface MarketMetric {
  id: MarketMetricId;
  label: string;
  status: "ready" | "unavailable";
  message: string | null;
  value: number | null;
  unit: "usd" | "usd_compact" | "usd_millions" | "percent" | "index";
  change: number | null;
  changeType: "percent" | "basis_points" | null;
  asOf: string | null;
  frequency: string;
  source: string;
  sourceUrl: string;
  historyStatus: "ready" | "unavailable";
  historyMessage: string | null;
  points: MarketPoint[];
}

export interface MarketDashboard {
  status: "ready" | "partial" | "unavailable";
  updatedAt: string;
  metrics: MarketMetric[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
