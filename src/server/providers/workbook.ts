import { JWT } from "google-auth-library";
import type {
  ModelSignal,
  WorkbookDashboard,
  WorkbookModelResults,
  WorkbookModelSignal,
  WorkbookRatioModel,
  WorkbookSignalSnapshot,
  WorkbookScorePoint,
  WorkbookScoreSeries,
  WorkbookTabCategory,
  WorkbookTabSummary
} from "../../shared/contracts.js";
import { currentSignals } from "../data/astrava.js";

type SheetRows = string[][];

interface SheetDefinition {
  name: string;
  sourceName?: string;
  modelId?: "sniper1d" | "mtpi" | "btc1w" | "ltpi";
  scoreLabel?: RegExp;
  category: WorkbookTabCategory;
  description: string;
}

interface GoogleValueRange {
  range?: string;
  values?: unknown[][];
}

interface GoogleBatchGetResponse {
  valueRanges?: GoogleValueRange[];
}

const sheetDefinitions: SheetDefinition[] = [
  { name: "Command Center", category: "allocation", description: "Published allocation and system command view." },
  { name: "Model Results", category: "forward_test", description: "Published historical simulated backtest results and review flags." },
  { name: "SMPS", sourceName: "RSPS", category: "relative_strength", description: "Strength Module Portfolio System Strategy ratio models." },
  { name: "Alternative SMPS", sourceName: "Alts RSPS", category: "relative_strength", description: "Alternative-asset Strength Module Portfolio System Strategy ratio models." },
  { name: "RSPS Published Feed", category: "relative_strength", description: "Formula-linked publication feed for all published relative-strength relationships." },
  { name: "Total ES 1D", sourceName: "1D SNIPER V1", modelId: "sniper1d", scoreLabel: /^SNIPER Composite Score$/i, category: "core_model", description: "Total-market model components from the 1D SNIPER V1 research tab." },
  { name: "MTPI Total", sourceName: "MTPI", modelId: "mtpi", scoreLabel: /^MTPI Avg Score$/i, category: "core_model", description: "Medium-term total-market trend model components." },
  { name: "BTC 1W", sourceName: "New BTC", modelId: "btc1w", scoreLabel: /^BTC Avg Score$/i, category: "core_model", description: "Bitcoin one-week model components." },
  { name: "Long-Term Trend", sourceName: "LT", modelId: "ltpi", scoreLabel: /^LTPI Avg Score$/i, category: "core_model", description: "Long-term Bitcoin and total-market trend components." },
  { name: "Total ES 1D Forward Test", sourceName: "SNIPER V1 Forward Testing", category: "forward_test", description: "Dated Total ES 1D score observations." },
  { name: "MTPI Total Forward Test", sourceName: "MT Forward Testing", category: "forward_test", description: "Dated MTPI Total score observations." },
  { name: "BTC 1W Forward Test", sourceName: "BTC 6D Forward Testing", category: "forward_test", description: "Dated BTC 1W score observations." },
  { name: "Long-Term Forward Test", sourceName: "LT Forward Testing", category: "forward_test", description: "Dated long-term trend observations." },
  { name: "BTC", category: "asset_model", description: "Bitcoin trend probability model components." },
  { name: "ETH", category: "asset_model", description: "Ethereum trend probability model components." },
  { name: "SOL", category: "asset_model", description: "Solana trend probability model components." },
  { name: "HYPE", category: "asset_model", description: "HYPE trend probability model components." },
  { name: "SUI", category: "asset_model", description: "SUI trend probability model components." },
  { name: "Others.D TPM", sourceName: "Others.D TPI", category: "breadth", description: "Crypto breadth and others-dominance Trend Probability Module." },
  { name: "ALT Selection Table", category: "selection", description: "Alternative-asset selection research table." },
  { name: "Trash Tournament", category: "selection", description: "Experimental asset-selection tournament." }
];

const scoreScopes: Record<string, string> = {
  sniper1d: "Daily Total ES trend model from the 1D SNIPER V1 system.",
  mtpi: "Medium-term total-market trend model.",
  btc1w: "Bitcoin one-week trend model.",
  ltpi: "Long-term aggregate of total crypto market cap and Bitcoin.",
  mrpi: "Weekly 10-year Treasury pressure model, read as tightening versus easing."
};

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanRows(values: unknown[][] | undefined): SheetRows {
  return (values ?? []).map((row) => row.map(cleanCell));
}

function finiteScore(value: string): number | null {
  if (!value || /^#/.test(value)) return null;
  const parsed = Number(value.replace(/[,+%$]/g, ""));
  return Number.isFinite(parsed) && parsed >= -1 && parsed <= 1 ? parsed : null;
}

function sheetId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleState(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function regimeForScore(score: number): string {
  if (score <= -0.75) return "EXTREME RISK-OFF";
  if (score < -0.25) return "DEFENSIVE CONTRACTION";
  if (score <= 0.25) return "NEUTRAL TRANSITION";
  if (score < 0.75) return "CONSTRUCTIVE EXPANSION";
  return "FULL RISK-ON";
}

function trendRiskStateForScore(score: number): "RISK-ON" | "RISK-OFF" {
  return score >= 0 ? "RISK-ON" : "RISK-OFF";
}

function rowSummary(row: string[]): { score: number; state: string } | null {
  const labelIndex = row.findIndex((cell) => /avg\s*score/i.test(cell));
  if (labelIndex < 0) return null;

  let score: number | null = null;
  let state = "";
  for (const cell of row.slice(labelIndex + 1)) {
    if (score === null) {
      score = finiteScore(cell);
      if (score !== null) continue;
    }
    if (!state && /long|short|neutral|risk|biased|bull|bear/i.test(cell)) state = titleState(cell);
  }
  return score === null ? null : { score, state: state || regimeForScore(score) };
}

function latestSummary(rows: SheetRows): { score: number; state: string } | null {
  const summaries = rows.map(rowSummary).filter((summary): summary is { score: number; state: string } => Boolean(summary));
  return summaries.at(-1) ?? null;
}

function modelSummary(modelId: SheetDefinition["modelId"], rows: SheetRows, scoreLabel?: RegExp): { score: number; state: string } | null {
  if (!modelId) return latestSummary(rows);
  const matcher = scoreLabel ?? /avg\s*score/i;
  const preferred = rows.flatMap((row) => {
    const labelIndex = row.findIndex((cell) => matcher.test(cell));
    if (labelIndex < 0) return [];
    let score: number | null = null;
    let state = "";
    for (const cell of row.slice(labelIndex + 1)) {
      if (score === null) {
        score = finiteScore(cell);
        if (score !== null) continue;
      }
      if (!state && /long|short|neutral|risk|biased|bull|bear/i.test(cell)) state = titleState(cell);
    }
    return score === null ? [] : [{ score, state: state || regimeForScore(score) }];
  });
  return preferred.at(-1) ?? latestSummary(rows);
}

function updatedLabel(rows: SheetRows): string | null {
  for (const row of rows.slice(0, 30)) {
    for (let index = 0; index < row.length; index += 1) {
      const cell = row[index] ?? "";
      if (!/date\s*updated|last\s*updated/i.test(cell)) continue;
      const inline = cell.replace(/^.*?(?:date\s*updated|last\s*updated)\s*:?\s*/i, "").trim();
      if (inline && inline !== cell) return inline;
      const adjacent = row.slice(index + 1).find(Boolean);
      if (adjacent) return adjacent;
    }
  }
  return null;
}

function dimensions(rows: SheetRows): { rowCount: number; columnCount: number } {
  const populated = rows.filter((row) => row.some(Boolean));
  return {
    rowCount: populated.length,
    columnCount: populated.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  };
}

export function summarizeTab(definition: SheetDefinition, rows: SheetRows): WorkbookTabSummary {
  const { rowCount, columnCount } = dimensions(rows);
  const summary = modelSummary(definition.modelId, rows, definition.scoreLabel);
  const latestState = summary?.score === undefined
    ? null
    : definition.modelId
      ? trendRiskStateForScore(summary.score)
      : summary.state;
  return {
    id: sheetId(definition.name),
    name: definition.name,
    category: definition.category,
    description: definition.description,
    status: rowCount > 0 ? "ready" : "unavailable",
    rowCount,
    columnCount,
    latestScore: summary?.score ?? null,
    latestState,
    updatedLabel: updatedLabel(rows),
    formulaErrorCount: rows.flat().filter((cell) => /^#(?:N\/A|DIV\/0!|REF!|VALUE!)/i.test(cell)).length
  };
}

function normalizedDate(value: string): string | null {
  if (!value || !/\d/.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function parseScoreSeries(
  id: WorkbookScoreSeries["id"],
  sourceTab: string,
  rows: SheetRows
): WorkbookScoreSeries {
  const label = ({ sniper1d: "Total ES 1D", mtpi: "MTPI Total", btc1w: "BTC 1W", ltpi: "Long-Term Trend", mrpi: "10US Treasury Module" } as Record<WorkbookScoreSeries["id"], string>)[id];
  const headerIndex = rows.findIndex(
    (row) => row.some((cell) => /^date$/i.test(cell)) && row.some((cell) => /(?:tpi|model)?\s*score/i.test(cell))
  );
  const inferredIndex = headerIndex < 0
    ? rows.findIndex((row) => row.some((cell) => normalizedDate(cell)) && row.some((cell) => finiteScore(cell) !== null))
    : -1;
  if (headerIndex < 0 && inferredIndex < 0) {
    return { id, label, sourceTab, status: "unavailable", message: "No dated score series was found.", points: [] };
  }

  const anchor = rows[headerIndex >= 0 ? headerIndex : inferredIndex]!;
  const dateIndex = headerIndex >= 0
    ? anchor.findIndex((cell) => /^date$/i.test(cell))
    : anchor.findIndex((cell) => normalizedDate(cell) !== null);
  const scoreIndex = headerIndex >= 0
    ? anchor.findIndex((cell) => /(?:tpi|model)?\s*score/i.test(cell))
    : anchor.findIndex((cell, index) => index !== dateIndex && finiteScore(cell) !== null);
  const byDate = new Map<string, number>();
  const dataStart = headerIndex >= 0 ? headerIndex + 1 : inferredIndex;
  for (const row of rows.slice(dataStart)) {
    const date = normalizedDate(row[dateIndex] ?? "");
    const score = finiteScore(row[scoreIndex] ?? "");
    if (date && score !== null) byDate.set(date, score);
  }

  const points: WorkbookScorePoint[] = [...byDate.entries()]
    .map(([date, score]) => ({ date, score }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return {
    id,
    label,
    sourceTab,
    status: points.length > 1 ? "ready" : "unavailable",
    message: points.length > 1 ? null : "The sheet does not yet contain enough dated score observations.",
    points
  };
}

function numericCell(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseModelResults(rows: SheetRows): WorkbookModelResults {
  const summary = rows.find((row) => row.some((cell) => /^As of$/i.test(cell))) ?? [];
  const summaryValue = (label: string): string | null => {
    const index = summary.findIndex((cell) => cell.toLowerCase() === label.toLowerCase());
    return index >= 0 ? summary[index + 1] || null : null;
  };
  const headerIndex = rows.findIndex((row) => row.some((cell) => /^Model$/i.test(cell)) && row.some((cell) => /^Timeframe$/i.test(cell)));
  const header = headerIndex >= 0 ? rows[headerIndex]! : [];
  const fixedColumns: Record<string, number> = {
    Model: 0, Timeframe: 1, Window: 2, "Start Date": 3, "End / As-of": 4, "Net Profit": 5,
    "Max Equity DD": 6, "Profit Factor": 8, "Win Rate": 9, Sharpe: 10, Trades: 14, "Review Status": 16
  };
  const column = (label: string) => {
    const detected = header.findIndex((cell) => cell.toLowerCase() === label.toLowerCase());
    return detected >= 0 ? detected : fixedColumns[label] ?? -1;
  };
  const valueAt = (row: string[], label: string) => {
    const index = column(label);
    return index >= 0 ? row[index] ?? "" : "";
  };
  const results = headerIndex < 0 ? [] : rows.slice(headerIndex + 1)
    .filter((row) => Boolean(valueAt(row, "Model")))
    .map((row) => ({
      model: valueAt(row, "Model"),
      timeframe: valueAt(row, "Timeframe"),
      window: valueAt(row, "Window"),
      startDate: valueAt(row, "Start Date"),
      endDate: valueAt(row, "End / As-of"),
      netProfit: valueAt(row, "Net Profit"),
      maxEquityDrawdown: valueAt(row, "Max Equity DD"),
      profitFactor: valueAt(row, "Profit Factor"),
      winRate: valueAt(row, "Win Rate"),
      sharpe: valueAt(row, "Sharpe"),
      trades: valueAt(row, "Trades"),
      reviewStatus: valueAt(row, "Review Status")
    }));
  const disclosure = rows.flat().find((cell) => /historical simulated results/i.test(cell))
    ?? "Historical simulated results. Backtests are not live trading results and do not predict future performance.";
  const numericPercent = (value: string) => Number(value.replace(/[,%]/g, ""));
  const maximumText = (values: string[]) => values
    .filter((value) => value.trim() && Number.isFinite(numericPercent(value)))
    .sort((left, right) => numericPercent(right) - numericPercent(left))[0] ?? null;
  return {
    status: results.length ? "ready" : "unavailable",
    sourceTab: "Model Results",
    asOf: summaryValue("As of"),
    modelCount: numericCell(summaryValue("Models") ?? "") ?? new Set(results.map((result) => result.model)).size,
    testCount: numericCell(summaryValue("Tests") ?? "") ?? results.length,
    bestNetProfit: summaryValue("Best Net Profit") ?? maximumText(results.map((result) => result.netProfit)),
    bestSharpe: summaryValue("Best Sharpe") ?? maximumText(results.map((result) => result.sharpe)),
    bestProfitFactor: summaryValue("Best Profit Factor") ?? maximumText(results.map((result) => result.profitFactor)),
    reviewFlags: numericCell(summaryValue("Review Flags") ?? "") ?? results.filter((result) => result.reviewStatus !== "Complete").length,
    disclosure,
    results
  };
}

export function parseCsv(csv: string): SheetRows {
  const rows: SheetRows = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function ratioLabel(value: string): string | null {
  const cleaned = value.replace(/avg\s*score.*$/i, "").replace(/\s*tp[im].*$/i, "").replace(/[^a-z0-9/]/gi, "").toUpperCase();
  if (!cleaned) return null;
  if (cleaned.includes("/")) return cleaned.replace("/", " / ");
  const assets = ["BTC", "ETH", "SOL", "SUI", "HYPE", "ENA", "LINK"];
  for (const left of assets) {
    if (cleaned.startsWith(left)) {
      const right = cleaned.slice(left.length);
      if (assets.includes(right)) return `${left} / ${right}`;
    }
  }
  return null;
}

export function parseRatioModels(sourceTab: "SMPS" | "Alternative SMPS", rows: SheetRows): WorkbookRatioModel[] {
  const models = new Map<string, WorkbookRatioModel>();
  let activeLabel: string | null = null;
  for (const row of rows) {
    const heading = row.find((cell) => /\bTP[IM]\s*$/i.test(cell));
    if (heading) activeLabel = ratioLabel(heading);

    const labelCell = row.find((cell) => /avg\s*score/i.test(cell));
    const summary = rowSummary(row);
    let label = labelCell ? ratioLabel(labelCell) : null;
    let finalSummary = summary;
    if (!finalSummary && activeLabel) {
      const scoreIndex = row.findIndex(
        (cell, index) => finiteScore(cell) !== null && row.slice(0, index).every((leadingCell) => !leadingCell)
      );
      const score = scoreIndex >= 0 ? finiteScore(row[scoreIndex] ?? "") : null;
      if (score !== null) {
        const publishedState = row[scoreIndex + 1] ?? "";
        const state = /^(?:long|short|neutral)$/i.test(publishedState)
          ? titleState(publishedState)
          : score > 0.25
            ? "LONG"
            : score < -0.25
              ? "SHORT"
              : "NEUTRAL";
        label = activeLabel;
        finalSummary = { score, state };
      }
    }
    if (!label || !finalSummary) continue;
    const id = sheetId(label);
    models.set(id, { id, label, score: finalSummary.score, state: finalSummary.state, sourceTab });
  }
  return [...models.values()];
}

export function parsePublishedRatioFeed(rows: SheetRows): WorkbookRatioModel[] {
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => cell.trim().toLowerCase());
    return normalized.includes("pair") && normalized.includes("source tab") && (normalized.includes("score") || normalized.includes("feed status"));
  });
  if (headerIndex < 0) return [];

  const header = rows[headerIndex]!.map((cell) => cell.trim().toLowerCase());
  const pairIndex = header.indexOf("pair");
  const sourceIndex = header.indexOf("source tab");
  const scoreIndex = header.indexOf("score") >= 0 ? header.indexOf("score") : 2;
  const stateIndex = header.indexOf("state");
  const updatedIndex = header.indexOf("source updated") >= 0 ? header.indexOf("source updated") : 4;
  const statusIndex = header.indexOf("feed status");
  const models = new Map<string, WorkbookRatioModel>();

  for (const row of rows.slice(headerIndex + 1)) {
    const label = ratioLabel(row[pairIndex] ?? "");
    const score = finiteScore(row[scoreIndex] ?? "");
    const sourceValue = row[sourceIndex]?.trim();
    if (!label || score === null || (sourceValue !== "SMPS" && sourceValue !== "Alternative SMPS")) continue;
    if (statusIndex >= 0 && row[statusIndex] && row[statusIndex]!.trim().toUpperCase() !== "READY") continue;
    const publishedState = stateIndex >= 0 ? row[stateIndex]?.trim() ?? "" : "";
    const state = /^(?:long|short|neutral)$/i.test(publishedState)
      ? titleState(publishedState)
      : score > 0.25
        ? "LONG"
        : score < -0.25
          ? "SHORT"
          : "NEUTRAL";
    const id = sheetId(label);
    models.set(id, {
      id,
      label,
      score,
      state,
      sourceTab: sourceValue,
      updatedLabel: updatedIndex >= 0 ? row[updatedIndex]?.trim() || null : null
    });
  }
  return [...models.values()];
}

function fallbackSignal(id: string): WorkbookModelSignal {
  const fallback = currentSignals.find((signal) => signal.id === id)!;
  return {
    ...fallback,
    state: id === "mrpi" ? fallback.state : trendRiskStateForScore(fallback.value),
    regime: id === "mrpi" ? "TIGHTENING REGIME" : trendRiskStateForScore(fallback.value),
    source: "manual_fallback",
    sourceTab: null,
    updatedLabel: null
  };
}

function publishedSignal(id: "sniper1d" | "mtpi" | "btc1w" | "ltpi", tab: WorkbookTabSummary, sourceTab: string): WorkbookModelSignal {
  const fallback = currentSignals.find((signal) => signal.id === id)!;
  return {
    ...fallback,
    value: tab.latestScore!,
    state: trendRiskStateForScore(tab.latestScore!),
    regime: trendRiskStateForScore(tab.latestScore!),
    source: "google_sheets",
    sourceTab,
    updatedLabel: tab.updatedLabel
  };
}

export function buildWorkbookDashboard(
  rowsBySheet: Map<string, SheetRows>,
  refreshSeconds: number
): WorkbookDashboard {
  const tabs = sheetDefinitions.map((definition) => summarizeTab(definition, rowsBySheet.get(definition.name) ?? []));
  const signalDefinitions = [
    { id: "sniper1d", tab: "Total ES 1D", source: "1D SNIPER V1" },
    { id: "mtpi", tab: "MTPI Total", source: "MTPI" },
    { id: "btc1w", tab: "BTC 1W", source: "New BTC" },
    { id: "ltpi", tab: "Long-Term Trend", source: "LT" }
  ] as const;
  const signals = signalDefinitions.map(({ id, tab, source }) => {
    const summary = tabs.find((candidate) => candidate.name === tab)!;
    return summary.latestScore === null ? fallbackSignal(id) : publishedSignal(id, summary, source);
  });
  const mrpi = fallbackSignal("mrpi");
  const scoreSeries = [
    parseScoreSeries("sniper1d", "SNIPER V1 Forward Testing", rowsBySheet.get("Total ES 1D Forward Test") ?? []),
    parseScoreSeries("mtpi", "MT Forward Testing", rowsBySheet.get("MTPI Total Forward Test") ?? []),
    parseScoreSeries("btc1w", "BTC 6D Forward Testing", rowsBySheet.get("BTC 1W Forward Test") ?? []),
    parseScoreSeries("ltpi", "LT Forward Testing", rowsBySheet.get("Long-Term Forward Test") ?? [])
  ];
  const modelResults = parseModelResults(rowsBySheet.get("Model Results") ?? []);
  const publishedRatioModels = parsePublishedRatioFeed(rowsBySheet.get("RSPS Published Feed") ?? []);
  const ratioModels = publishedRatioModels.length
    ? publishedRatioModels
    : [
        ...parseRatioModels("SMPS", rowsBySheet.get("SMPS") ?? []),
        ...parseRatioModels("Alternative SMPS", rowsBySheet.get("Alternative SMPS") ?? [])
      ];
  const readyTabs = tabs.filter((tab) => tab.status === "ready").length;
  const warnings: string[] = [];
  if (signals.some((signal) => signal.source !== "google_sheets")) warnings.push("A trend reading could not be verified; affected readings use the manual fallback snapshot.");
  if (scoreSeries.some((series) => series.status === "unavailable")) warnings.push("One or more forward-test histories do not yet contain enough populated dated observations.");
  if (!publishedRatioModels.length) warnings.push("The structured RSPS publication feed is unavailable; relative-strength readings are using the validated source-tab parser.");
  warnings.push("10US Treasury Module is sourced from a separate weekly system workbook.");
  if (tabs.some((tab) => tab.formulaErrorCount > 0)) warnings.push("Some research cells contain spreadsheet formula errors; they are reported as unavailable, never as zero.");
  return {
    status: readyTabs === tabs.length ? "ready" : readyTabs > 0 ? "partial" : "unavailable",
    provider: "Google Sheets",
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    signals: [...signals, mrpi],
    scoreSeries,
    modelResults,
    ratioModels,
    tabs,
    warnings
  };
}

export function workbookSignalSnapshot(dashboard: WorkbookDashboard): WorkbookSignalSnapshot {
  const publishedCount = dashboard.signals.filter((signal) => signal.source !== "manual_fallback").length;
  return {
    status: publishedCount === dashboard.signals.length
      ? "ready"
      : publishedCount > 0
        ? "partial"
        : dashboard.status === "not_configured"
          ? "not_configured"
          : "unavailable",
    provider: publishedCount > 0 ? dashboard.provider : null,
    updatedAt: dashboard.updatedAt,
    refreshSeconds: dashboard.refreshSeconds,
    signals: dashboard.signals
  };
}

export function buildWorkbookSignalSnapshot(
  rowsBySheet: Map<string, SheetRows>,
  refreshSeconds: number
): WorkbookSignalSnapshot {
  return workbookSignalSnapshot(buildWorkbookDashboard(rowsBySheet, refreshSeconds));
}

export interface WorkbookProvider {
  getDashboard(): Promise<WorkbookDashboard>;
  getSignalSnapshot?(): Promise<WorkbookSignalSnapshot>;
}

export class GoogleSheetsWorkbookProvider implements WorkbookProvider {
  private readonly auth: JWT;
  private cache: { expiresAt: number; dashboard: WorkbookDashboard } | null = null;
  private signalCache: { expiresAt: number; snapshot: WorkbookSignalSnapshot } | null = null;

  private get signalCacheMs(): number {
    return Math.min(this.cacheMs, 60_000);
  }

  constructor(
    private readonly spreadsheetId: string,
    serviceAccountEmail: string,
    privateKey: string,
    private readonly cacheMs: number
  ) {
    this.auth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });
  }

  async getDashboard(): Promise<WorkbookDashboard> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.dashboard;
    try {
      const query = new URLSearchParams({
        majorDimension: "ROWS",
        valueRenderOption: "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING"
      });
      for (const definition of sheetDefinitions) {
        const sourceName = definition.sourceName ?? definition.name;
        query.append("ranges", `'${sourceName.replace(/'/g, "''")}'!A1:AZ2000`);
      }
      const response = await this.auth.request<GoogleBatchGetResponse>({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values:batchGet?${query}`,
        method: "GET",
        timeout: 12_000
      });
      const rowsBySheet = new Map<string, SheetRows>();
      for (let index = 0; index < sheetDefinitions.length; index += 1) {
        rowsBySheet.set(sheetDefinitions[index]!.name, cleanRows(response.data.valueRanges?.[index]?.values));
      }
      const dashboard = buildWorkbookDashboard(rowsBySheet, Math.round(this.cacheMs / 1000));
      this.cache = { expiresAt: Date.now() + this.cacheMs, dashboard };
      return dashboard;
    } catch {
      return unavailableWorkbook("AstravaQuant could not reach the private research workbook. The last manual model snapshot remains visible.", Math.round(this.cacheMs / 1000));
    }
  }

  async getSignalSnapshot(): Promise<WorkbookSignalSnapshot> {
    if (this.cache && this.cache.expiresAt - this.cacheMs + this.signalCacheMs > Date.now()) {
      return { ...workbookSignalSnapshot(this.cache.dashboard), refreshSeconds: Math.round(this.signalCacheMs / 1000) };
    }
    if (this.signalCache && this.signalCache.expiresAt > Date.now()) return this.signalCache.snapshot;
    try {
      const query = new URLSearchParams({
        majorDimension: "ROWS",
        valueRenderOption: "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING"
      });
      for (const name of ["1D SNIPER V1", "MTPI", "New BTC", "LT"]) query.append("ranges", `'${name}'!A1:AZ100`);
      const response = await this.auth.request<GoogleBatchGetResponse>({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values:batchGet?${query}`,
        method: "GET",
        timeout: 8_000
      });
      const rowsBySheet = new Map<string, SheetRows>();
      ["Total ES 1D", "MTPI Total", "BTC 1W", "Long-Term Trend"].forEach((name, index) => rowsBySheet.set(name, cleanRows(response.data.valueRanges?.[index]?.values)));
      const snapshot = buildWorkbookSignalSnapshot(rowsBySheet, Math.round(this.signalCacheMs / 1000));
      if (snapshot.status !== "unavailable") {
        this.signalCache = { expiresAt: Date.now() + this.signalCacheMs, snapshot };
      }
      return snapshot;
    } catch {
      return workbookSignalSnapshot(unavailableWorkbook(
        "AstravaQuant could not reach the private research workbook.",
        Math.round(this.cacheMs / 1000)
      ));
    }
  }
}

export class PublicGoogleSheetsWorkbookProvider implements WorkbookProvider {
  private cache: { expiresAt: number; dashboard: WorkbookDashboard } | null = null;
  private signalCache: { expiresAt: number; snapshot: WorkbookSignalSnapshot } | null = null;

  private get signalCacheMs(): number {
    return Math.min(this.cacheMs, 60_000);
  }

  constructor(
    private readonly spreadsheetId: string,
    private readonly cacheMs: number,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async fetchSheet(name: string, range?: string): Promise<SheetRows> {
    try {
      const query = new URLSearchParams({ tqx: "out:csv", headers: "0", sheet: name });
      if (range) query.set("range", range);
      const response = await this.fetcher(
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.spreadsheetId)}/gviz/tq?${query}`,
        { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(8_000) }
      );
      if (!response.ok || !response.headers.get("content-type")?.includes("text/csv")) return [];
      return parseCsv(await response.text());
    } catch {
      return [];
    }
  }

  async getDashboard(): Promise<WorkbookDashboard> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.dashboard;
    try {
      const sheetResults = await Promise.all(
        sheetDefinitions.map(async (definition): Promise<[string, SheetRows]> => {
          return [definition.name, await this.fetchSheet(definition.sourceName ?? definition.name)];
        })
      );
      const dashboard = buildWorkbookDashboard(new Map(sheetResults), Math.round(this.cacheMs / 1000));
      this.cache = { expiresAt: Date.now() + this.cacheMs, dashboard };
      return dashboard;
    } catch {
      return unavailableWorkbook(
        "AstravaQuant could not read the link-shared research workbook. The manual model snapshot remains visible.",
        Math.round(this.cacheMs / 1000)
      );
    }
  }

  async getSignalSnapshot(): Promise<WorkbookSignalSnapshot> {
    if (this.cache && this.cache.expiresAt - this.cacheMs + this.signalCacheMs > Date.now()) {
      return { ...workbookSignalSnapshot(this.cache.dashboard), refreshSeconds: Math.round(this.signalCacheMs / 1000) };
    }
    if (this.signalCache && this.signalCache.expiresAt > Date.now()) return this.signalCache.snapshot;
    const signalSheets: Array<[string, string]> = [
      ["Total ES 1D", "1D SNIPER V1"],
      ["MTPI Total", "MTPI"],
      ["BTC 1W", "New BTC"],
      ["Long-Term Trend", "LT"]
    ];
    const sheetResults = await Promise.all(
      signalSheets.map(async ([name, sourceName]): Promise<[string, SheetRows]> => [name, await this.fetchSheet(sourceName, "A1:AZ100")])
    );
    const snapshot = buildWorkbookSignalSnapshot(new Map(sheetResults), Math.round(this.signalCacheMs / 1000));
    if (snapshot.status !== "unavailable") {
      this.signalCache = { expiresAt: Date.now() + this.signalCacheMs, snapshot };
    }
    return snapshot;
  }
}

export class UnavailableWorkbookProvider implements WorkbookProvider {
  constructor(private readonly cacheMs: number) {}

  async getDashboard(): Promise<WorkbookDashboard> {
    return unavailableWorkbook(
      "Private Google Sheets access is not configured on this deployment. Add the read-only service-account credentials to enable automatic updates.",
      Math.round(this.cacheMs / 1000),
      "not_configured"
    );
  }

  async getSignalSnapshot(): Promise<WorkbookSignalSnapshot> {
    return workbookSignalSnapshot(await this.getDashboard());
  }
}

function unavailableWorkbook(
  message: string,
  refreshSeconds: number,
  status: WorkbookDashboard["status"] = "unavailable"
): WorkbookDashboard {
  const signals = currentSignals.map((signal) => fallbackSignal(signal.id));
  return {
    status,
    provider: null,
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    signals,
    scoreSeries: [
      { id: "sniper1d", label: "Total ES 1D", sourceTab: "SNIPER V1 Forward Testing", status: "unavailable", message, points: [] },
      { id: "mtpi", label: "MTPI Total", sourceTab: "MT Forward Testing", status: "unavailable", message, points: [] },
      { id: "btc1w", label: "BTC 1W", sourceTab: "BTC 6D Forward Testing", status: "unavailable", message, points: [] },
      { id: "ltpi", label: "Long-Term Trend", sourceTab: "LT Forward Testing", status: "unavailable", message, points: [] }
    ],
    modelResults: parseModelResults([]),
    ratioModels: [],
    tabs: sheetDefinitions.map((definition) => summarizeTab(definition, [])),
    warnings: [message, "10US Treasury Module is sourced from a separate weekly system workbook."]
  };
}

export function workbookSignals(dashboard: WorkbookDashboard): ModelSignal[] {
  return dashboard.signals.map(({ id, name, value, state, scope, relevantSymbols }) => ({
    id,
    name,
    value,
    state,
    scope: scoreScopes[id] ?? scope,
    relevantSymbols: id === "mrpi" ? [] : relevantSymbols
  }));
}
