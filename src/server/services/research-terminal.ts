import type {
  AuthSession,
  BitcoinValuationDashboard,
  MarketDashboard,
  PublishedScoreRecord,
  ResearchDataConnection,
  ResearchMetric,
  ResearchStrategy,
  ResearchStrategyId,
  ResearchTerminalDashboard,
  WorkbookDashboard,
  WorkbookScoreSeries
} from "../../shared/contracts.js";
interface ResearchTerminalSourceConfig {
  googleSheetsConfigured: boolean;
  googleSheetsId: string | null;
  valuationSheetsId: string;
  mrpiSheetsId: string;
}

const unavailablePerformanceReason = "A dated strategy portfolio-value series, aligned benchmark series, currency, starting capital, and cash-flow history have not been mapped from the source workbook.";

function unavailableMetrics(): ResearchMetric[] {
  return ["Portfolio value", "Total return", "CAGR", "Maximum drawdown", "Volatility", "Sharpe", "Sortino", "Excess return"]
    .map((label) => ({ label, value: null, status: "unavailable", reason: unavailablePerformanceReason }));
}

function strategy(
  workbook: WorkbookDashboard,
  definition: Omit<ResearchStrategy, "signal" | "scoreHistory" | "performanceMetrics" | "performanceMessage"> & { modelId: string }
): ResearchStrategy {
  const signal = workbook.signals.find((candidate) => candidate.id === definition.modelId) ?? null;
  const scoreHistory = workbook.scoreSeries.find((candidate) => candidate.id === definition.modelId) ?? null;
  const { modelId: _modelId, ...published } = definition;
  void _modelId;
  return {
    ...published,
    signal,
    scoreHistory,
    performanceMetrics: unavailableMetrics(),
    performanceMessage: unavailablePerformanceReason
  };
}

function strategyForModel(modelId: string): ResearchStrategyId | null {
  if (modelId === "mtpi") return "mtpi";
  if (modelId === "sniper1d") return "sniper-v1";
  return null;
}

function modelContext(modelId: string): { asset: string; timeframe: string } {
  const contexts: Record<string, { asset: string; timeframe: string }> = {
    sniper1d: { asset: "Total crypto market", timeframe: "1D" },
    mtpi: { asset: "Total crypto market", timeframe: "Medium-term" },
    btc1w: { asset: "Bitcoin", timeframe: "1W" },
    ltpi: { asset: "Bitcoin + total crypto", timeframe: "Long-term" },
    mrpi: { asset: "U.S. 10-year Treasury", timeframe: "1W" }
  };
  return contexts[modelId] ?? { asset: "Unresolved", timeframe: "Unresolved" };
}

function publications(workbook: WorkbookDashboard): PublishedScoreRecord[] {
  const signals = new Map(workbook.signals.map((signal) => [signal.id, signal]));
  return workbook.scoreSeries
    .flatMap((series) => series.points.map((point) => {
      const context = modelContext(series.id);
      return {
        id: `${series.id}-${point.date}`,
        strategyId: strategyForModel(series.id),
        modelId: series.id,
        modelName: series.label,
        asset: context.asset,
        timeframe: context.timeframe,
        observationDate: point.date,
        publicationTimestamp: null,
        publicationTimezone: null,
        score: point.score,
        regime: point.score >= 0 ? "RISK-ON" : "RISK-OFF",
        commentary: null,
        originalPublicationUrl: null,
        revision: 1
      } satisfies PublishedScoreRecord;
    }))
    .sort((left, right) => right.observationDate.localeCompare(left.observationDate) || left.modelName.localeCompare(right.modelName))
    .slice(0, 500)
    .map((record) => ({
      ...record,
      regime: signals.get(record.modelId)?.updatedLabel === record.observationDate
        ? signals.get(record.modelId)!.state
        : record.regime
    }));
}

function latestObservation(series: WorkbookScoreSeries[]): string | null {
  return series.flatMap((item) => item.points.map((point) => point.date)).sort().at(-1) ?? null;
}

function connectionStatus(value: "ready" | "partial" | "not_configured" | "unavailable"): ResearchDataConnection["status"] {
  return value === "ready" ? "ready" : value === "partial" ? "partial" : "unavailable";
}

export function buildResearchTerminalDashboard(
  session: AuthSession,
  workbook: WorkbookDashboard,
  valuation: BitcoinValuationDashboard,
  markets: MarketDashboard,
  config: ResearchTerminalSourceConfig
): ResearchTerminalDashboard {
  const strategies: ResearchStrategy[] = [
    strategy(workbook, {
      id: "mtpi",
      modelId: "mtpi",
      displayName: "MTPI",
      version: "Current published version",
      emblem: null,
      originalSourceLabels: ["MTPI", "Strategy One", "Strat One"],
      sourceTabs: ["MTPI", "MT Forward Testing"],
      asset: "Total crypto market",
      timeframe: "Medium-term",
      researchStatus: "forward_test",
      description: "Medium-term total-market trend research with a separately preserved dated forward-test record.",
      rulesSummary: "Rules remain defined in the source research workbook. The terminal publishes the normalized score and dated observations without modifying model calculations."
    }),
    strategy(workbook, {
      id: "sniper-v1",
      modelId: "sniper1d",
      displayName: "Sniper V1",
      version: "V1",
      emblem: "🐍",
      originalSourceLabels: ["Total ES1D", "1D SNIPER V1", "Sniper V1"],
      sourceTabs: ["1D SNIPER V1", "SNIPER V1 Forward Testing"],
      asset: "Total crypto market",
      timeframe: "1D",
      researchStatus: "forward_test",
      description: "Daily Total ES quantitative trend research with an independently maintained forward-test history.",
      rulesSummary: "The current composite is read from 1D SNIPER V1. Dated observations are read only from SNIPER V1 Forward Testing; blank future rows are excluded."
    })
  ];

  const connections: ResearchDataConnection[] = [
    {
      id: "core-research",
      name: "Core research workbook",
      provider: "Google Sheets",
      access: config.googleSheetsConfigured ? "server_read_only" : "public_read_only",
      status: connectionStatus(workbook.status),
      spreadsheetId: config.googleSheetsId ?? "Not configured",
      sourceTabs: workbook.tabs.map((tab) => tab.name),
      mappedFields: ["model score", "regime", "observation date", "forward-test score", "backtest summary", "review status"],
      lastSuccessfulSync: workbook.status === "unavailable" || workbook.status === "not_configured" ? null : workbook.updatedAt,
      latestObservationDate: latestObservation(workbook.scoreSeries.filter((series) => series.id !== "mrpi")),
      message: "Normalized server-side. Missing values and formula errors are never converted to zero."
    },
    {
      id: "bitcoin-valuation",
      name: "Bitcoin valuation workbook",
      provider: "Google Sheets",
      access: "public_read_only",
      status: valuation.status,
      spreadsheetId: config.valuationSheetsId,
      sourceTabs: ["SDCA", "Forward Testing"],
      mappedFields: ["valuation score", "indicator", "category", "observation date", "methodology source"],
      lastSuccessfulSync: valuation.status === "unavailable" ? null : valuation.updatedAt,
      latestObservationDate: valuation.workbookUpdatedLabel,
      message: "Valuation measures stay separate from trend and momentum signals."
    },
    {
      id: "treasury-pressure",
      name: "Treasury pressure workbook",
      provider: "Google Sheets",
      access: "public_read_only",
      status: workbook.mrpiSystem?.status ?? "unavailable",
      spreadsheetId: config.mrpiSheetsId,
      sourceTabs: ["Weekly LPI"],
      mappedFields: ["Treasury pressure score", "criterion", "observation date", "source URL"],
      lastSuccessfulSync: workbook.mrpiSystem?.status === "unavailable" ? null : workbook.mrpiSystem?.updatedAt ?? null,
      latestObservationDate: workbook.scoreSeries.find((series) => series.id === "mrpi")?.points.at(-1)?.date ?? null,
      message: "Weekly rates context with a tightening-to-easing interpretation."
    }
  ];

  return {
    session,
    generatedAt: new Date().toISOString(),
    strategies,
    workbook,
    valuation,
    markets,
    publications: publications(workbook),
    connections,
    unresolvedSourceLabels: [
      "long-term trend",
      "weekly / one-week",
      "Bitcoin total",
      "0.9 total",
      "0.9 total long-term trend weekly",
      "Bitcoin weekly chart"
    ]
  };
}
