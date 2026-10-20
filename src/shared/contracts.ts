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

export type WorkbookTabCategory =
  | "allocation"
  | "relative_strength"
  | "core_model"
  | "forward_test"
  | "asset_model"
  | "breadth"
  | "selection";

export interface WorkbookTabSummary {
  id: string;
  name: string;
  category: WorkbookTabCategory;
  description: string;
  status: "ready" | "unavailable";
  rowCount: number;
  columnCount: number;
  latestScore: number | null;
  latestState: string | null;
  updatedLabel: string | null;
  formulaErrorCount: number;
}

export interface WorkbookModelSignal extends ModelSignal {
  regime: string;
  source: "google_sheets" | "manual_fallback";
  sourceTab: string | null;
  updatedLabel: string | null;
}

export interface WorkbookScorePoint {
  date: string;
  score: number;
}

export interface WorkbookScoreSeries {
  id: "sniper1d" | "mtpi" | "btc1w" | "ltpi" | "mrpi";
  label: string;
  sourceTab: string;
  status: "ready" | "unavailable";
  message: string | null;
  points: WorkbookScorePoint[];
}

export interface WorkbookBacktestResult {
  model: string;
  timeframe: string;
  window: string;
  startDate: string;
  endDate: string;
  netProfit: string;
  maxEquityDrawdown: string;
  profitFactor: string;
  winRate: string;
  sharpe: string;
  trades: string;
  reviewStatus: string;
}

export interface WorkbookModelResults {
  status: "ready" | "unavailable";
  sourceTab: "Model Results";
  asOf: string | null;
  modelCount: number | null;
  testCount: number | null;
  bestNetProfit: string | null;
  bestSharpe: string | null;
  bestProfitFactor: string | null;
  reviewFlags: number | null;
  disclosure: string;
  results: WorkbookBacktestResult[];
}

export interface MrpiIndicator {
  id: string;
  name: string;
  state: string;
  description: string;
  score: number;
  sourceUrl: string | null;
}

export interface MrpiDashboard {
  status: "ready" | "partial" | "unavailable";
  provider: "Google Sheets" | null;
  updatedAt: string;
  refreshSeconds: number;
  workbookUpdatedLabel: string | null;
  sourceUrl: string;
  score: number | null;
  calculatedScore: number | null;
  state: string | null;
  indicatorCount: number;
  indicators: MrpiIndicator[];
  historyStatus: "ready" | "unavailable";
  historyMessage: string | null;
  history: WorkbookScorePoint[];
  warnings: string[];
}

export interface WorkbookRatioModel {
  id: string;
  label: string;
  score: number;
  state: string;
  sourceTab: "SMPS" | "Alternative SMPS";
}

export interface WorkbookDashboard {
  status: "ready" | "partial" | "not_configured" | "unavailable";
  provider: "Google Sheets" | null;
  updatedAt: string;
  refreshSeconds: number;
  signals: WorkbookModelSignal[];
  scoreSeries: WorkbookScoreSeries[];
  modelResults?: WorkbookModelResults;
  ratioModels: WorkbookRatioModel[];
  tabs: WorkbookTabSummary[];
  warnings: string[];
  mrpiSystem?: MrpiDashboard;
}

export interface WorkbookSignalSnapshot {
  status: "ready" | "partial" | "not_configured" | "unavailable";
  provider: "Google Sheets" | null;
  updatedAt: string;
  refreshSeconds: number;
  signals: WorkbookModelSignal[];
}

export type ResearchStrategyId = "mtpi" | "sniper-v1";

export interface ResearchMetric {
  label: string;
  value: string | null;
  status: "ready" | "unavailable";
  reason: string | null;
}

export interface ResearchStrategy {
  id: ResearchStrategyId;
  displayName: string;
  version: string;
  emblem: string | null;
  originalSourceLabels: string[];
  sourceTabs: string[];
  asset: string;
  timeframe: string;
  researchStatus: "backtest" | "forward_test" | "paper_trading" | "live";
  description: string;
  rulesSummary: string;
  signal: WorkbookModelSignal | null;
  scoreHistory: WorkbookScoreSeries | null;
  performanceMetrics: ResearchMetric[];
  performanceMessage: string;
}

export interface PublishedScoreRecord {
  id: string;
  strategyId: ResearchStrategyId | null;
  modelId: string;
  modelName: string;
  asset: string;
  timeframe: string;
  observationDate: string;
  publicationTimestamp: string | null;
  publicationTimezone: string | null;
  score: number;
  regime: string;
  commentary: string | null;
  originalPublicationUrl: string | null;
  revision: number;
}

export interface ResearchDataConnection {
  id: string;
  name: string;
  provider: "Google Sheets";
  access: "server_read_only" | "public_read_only";
  status: "ready" | "partial" | "unavailable";
  spreadsheetId: string;
  sourceTabs: string[];
  mappedFields: string[];
  lastSuccessfulSync: string | null;
  latestObservationDate: string | null;
  message: string;
}

export interface ResearchTerminalDashboard {
  session: AuthSession;
  generatedAt: string;
  strategies: ResearchStrategy[];
  workbook: WorkbookDashboard;
  valuation: BitcoinValuationDashboard;
  markets: MarketDashboard;
  publications: PublishedScoreRecord[];
  connections: ResearchDataConnection[];
  unresolvedSourceLabels: string[];
}

export type ValuationCategoryId = "fundamental" | "technical" | "sentiment";

export interface ValuationIndicator {
  id: string;
  name: string;
  category: ValuationCategoryId;
  categoryLabel: string;
  state: string;
  description: string;
  score: number;
  sourceUrl: string | null;
}

export interface ValuationCategorySummary {
  id: ValuationCategoryId;
  label: string;
  indicatorCount: number;
  averageScore: number;
}

export interface ValuationPoint {
  date: string;
  score: number;
}

export interface BitcoinValuationDashboard {
  status: "ready" | "partial" | "unavailable";
  provider: "Google Sheets" | null;
  updatedAt: string;
  refreshSeconds: number;
  workbookUpdatedLabel: string | null;
  sourceUrl: string;
  score: number | null;
  calculatedScore: number | null;
  invertedScore: number | null;
  state: string | null;
  invertedState: string | null;
  scaleMin: number;
  scaleMax: number;
  indicatorCount: number;
  indicators: ValuationIndicator[];
  categories: ValuationCategorySummary[];
  historyStatus: "ready" | "unavailable";
  historyMessage: string | null;
  history: ValuationPoint[];
  warnings: string[];
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
  | "solana"
  | "sui"
  | "hyperliquid"
  | "treasury10y"
  | "fedLiquidity"
  | "fedNetLiquidity"
  | "treasuryGeneralAccount"
  | "reverseRepo"
  | "bankTermFundingProgram"
  | "primaryCredit"
  | "m2MoneySupply"
  | "stablecoinSupply"
  | "sp500"
  | "nasdaq"
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
  unit: "usd" | "usd_compact" | "usd_millions" | "usd_billions" | "percent" | "index";
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
