import { JWT } from "google-auth-library";
import type {
  ModelSignal,
  WorkbookDashboard,
  WorkbookModelSignal,
  WorkbookRatioModel,
  WorkbookScorePoint,
  WorkbookScoreSeries,
  WorkbookTabCategory,
  WorkbookTabSummary
} from "../../shared/contracts.js";
import { currentSignals } from "../data/astrava.js";

type SheetRows = string[][];

interface SheetDefinition {
  name: string;
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
  { name: "RSPS", category: "relative_strength", description: "Core relative-strength portfolio ratios." },
  { name: "Alts RSPS", category: "relative_strength", description: "Alternative-asset relative-strength ratios." },
  { name: "MTPI", category: "core_model", description: "Five-day total-market and TOTAL2 model components." },
  { name: "LTPI", category: "core_model", description: "Weekly total-market and Bitcoin model components." },
  { name: "MT Total Forward Testing", category: "forward_test", description: "Historical medium-term model score observations." },
  { name: "LT Total Forward Testing", category: "forward_test", description: "Historical long-term model score observations." },
  { name: "BTC", category: "asset_model", description: "Bitcoin trend probability model components." },
  { name: "ETH", category: "asset_model", description: "Ethereum trend probability model components." },
  { name: "SOL", category: "asset_model", description: "Solana trend probability model components." },
  { name: "HYPE", category: "asset_model", description: "HYPE trend probability model components." },
  { name: "SUI", category: "asset_model", description: "SUI trend probability model components." },
  { name: "Others.D TPI", category: "breadth", description: "Crypto breadth and others-dominance model." },
  { name: "ALT Selection Table", category: "selection", description: "Alternative-asset selection research table." },
  { name: "Trash Tournament", category: "selection", description: "Experimental asset-selection tournament." }
];

const scoreScopes: Record<string, string> = {
  mtpi: "Five-day aggregate of total crypto market cap and TOTAL2.",
  ltpi: "Weekly aggregate of total crypto market cap and Bitcoin.",
  nspi: "Derived aggregate of the published medium-term and long-term crypto trend.",
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
  const summary = latestSummary(rows);
  return {
    id: sheetId(definition.name),
    name: definition.name,
    category: definition.category,
    description: definition.description,
    status: rowCount > 0 ? "ready" : "unavailable",
    rowCount,
    columnCount,
    latestScore: summary?.score ?? null,
    latestState: summary?.state ?? null,
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
  id: "mtpi" | "ltpi",
  sourceTab: string,
  rows: SheetRows
): WorkbookScoreSeries {
  const headerIndex = rows.findIndex(
    (row) => row.some((cell) => /^date$/i.test(cell)) && row.some((cell) => /(?:tpi|model)?\s*score/i.test(cell))
  );
  if (headerIndex < 0) {
    return { id, label: id.toUpperCase(), sourceTab, status: "unavailable", message: "No dated score series was found.", points: [] };
  }

  const header = rows[headerIndex]!;
  const dateIndex = header.findIndex((cell) => /^date$/i.test(cell));
  const scoreIndex = header.findIndex((cell) => /(?:tpi|model)?\s*score/i.test(cell));
  const byDate = new Map<string, number>();
  for (const row of rows.slice(headerIndex + 1)) {
    const date = normalizedDate(row[dateIndex] ?? "");
    const score = finiteScore(row[scoreIndex] ?? "");
    if (date && score !== null) byDate.set(date, score);
  }

  const points: WorkbookScorePoint[] = [...byDate.entries()]
    .map(([date, score]) => ({ date, score }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return {
    id,
    label: id === "mtpi" ? "Medium-Term Trend" : "Long-Term Trend",
    sourceTab,
    status: points.length > 1 ? "ready" : "unavailable",
    message: points.length > 1 ? null : "The sheet does not yet contain enough dated score observations.",
    points
  };
}

function ratioLabel(value: string): string | null {
  const cleaned = value.replace(/avg\s*score.*$/i, "").replace(/\s*tpi.*$/i, "").replace(/[^a-z0-9/]/gi, "").toUpperCase();
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

export function parseRatioModels(sourceTab: "RSPS" | "Alts RSPS", rows: SheetRows): WorkbookRatioModel[] {
  const models = new Map<string, WorkbookRatioModel>();
  for (const row of rows) {
    const labelCell = row.find((cell) => /avg\s*score/i.test(cell));
    const summary = rowSummary(row);
    if (!labelCell || !summary) continue;
    const label = ratioLabel(labelCell);
    if (!label) continue;
    const id = sheetId(label);
    models.set(id, { id, label, score: summary.score, state: summary.state, sourceTab });
  }
  return [...models.values()];
}

function fallbackSignal(id: string): WorkbookModelSignal {
  const fallback = currentSignals.find((signal) => signal.id === id)!;
  return {
    ...fallback,
    regime: id === "mrpi" ? "TIGHTENING REGIME" : regimeForScore(fallback.value),
    source: "manual_fallback",
    sourceTab: null,
    updatedLabel: null
  };
}

function publishedSignal(id: "mtpi" | "ltpi", tab: WorkbookTabSummary): WorkbookModelSignal {
  const fallback = currentSignals.find((signal) => signal.id === id)!;
  return {
    ...fallback,
    value: tab.latestScore!,
    state: tab.latestState ?? regimeForScore(tab.latestScore!),
    regime: regimeForScore(tab.latestScore!),
    source: "google_sheets",
    sourceTab: tab.name,
    updatedLabel: tab.updatedLabel
  };
}

export function buildWorkbookDashboard(
  rowsBySheet: Map<string, SheetRows>,
  refreshSeconds: number
): WorkbookDashboard {
  const tabs = sheetDefinitions.map((definition) => summarizeTab(definition, rowsBySheet.get(definition.name) ?? []));
  const mtTab = tabs.find((tab) => tab.name === "MTPI")!;
  const ltTab = tabs.find((tab) => tab.name === "LTPI")!;
  const mtpi = mtTab.latestScore === null ? fallbackSignal("mtpi") : publishedSignal("mtpi", mtTab);
  const ltpi = ltTab.latestScore === null ? fallbackSignal("ltpi") : publishedSignal("ltpi", ltTab);
  const bothPublished = mtpi.source === "google_sheets" && ltpi.source === "google_sheets";
  const nspiValue = bothPublished ? Number(((mtpi.value + ltpi.value) / 2).toFixed(2)) : fallbackSignal("nspi").value;
  const nspi: WorkbookModelSignal = bothPublished
    ? {
        ...currentSignals.find((signal) => signal.id === "nspi")!,
        value: nspiValue,
        state: regimeForScore(nspiValue),
        regime: regimeForScore(nspiValue),
        source: "derived",
        sourceTab: "MTPI + LTPI",
        updatedLabel: mtpi.updatedLabel === ltpi.updatedLabel ? mtpi.updatedLabel : null
      }
    : fallbackSignal("nspi");
  const mrpi = fallbackSignal("mrpi");
  const scoreSeries = [
    parseScoreSeries("mtpi", "MT Total Forward Testing", rowsBySheet.get("MT Total Forward Testing") ?? []),
    parseScoreSeries("ltpi", "LT Total Forward Testing", rowsBySheet.get("LT Total Forward Testing") ?? [])
  ];
  const ratioModels = [
    ...parseRatioModels("RSPS", rowsBySheet.get("RSPS") ?? []),
    ...parseRatioModels("Alts RSPS", rowsBySheet.get("Alts RSPS") ?? [])
  ];
  const readyTabs = tabs.filter((tab) => tab.status === "ready").length;
  const warnings: string[] = [];
  if (!bothPublished) warnings.push("MTPI or LTPI could not be verified; affected readings use the manual fallback snapshot.");
  warnings.push("MRPI is not present in this crypto workbook and remains a separately published manual reading.");
  if (tabs.some((tab) => tab.formulaErrorCount > 0)) warnings.push("Some research cells contain spreadsheet formula errors; they are reported as unavailable, never as zero.");
  return {
    status: readyTabs === tabs.length ? "ready" : readyTabs > 0 ? "partial" : "unavailable",
    provider: "Google Sheets",
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    signals: [mtpi, ltpi, nspi, mrpi],
    scoreSeries,
    ratioModels,
    tabs,
    warnings
  };
}

export interface WorkbookProvider {
  getDashboard(): Promise<WorkbookDashboard>;
}

export class GoogleSheetsWorkbookProvider implements WorkbookProvider {
  private readonly auth: JWT;
  private cache: { expiresAt: number; dashboard: WorkbookDashboard } | null = null;

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
        query.append("ranges", `'${definition.name.replace(/'/g, "''")}'!A1:AZ2000`);
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
      { id: "mtpi", label: "Medium-Term Trend", sourceTab: "MT Total Forward Testing", status: "unavailable", message, points: [] },
      { id: "ltpi", label: "Long-Term Trend", sourceTab: "LT Total Forward Testing", status: "unavailable", message, points: [] }
    ],
    ratioModels: [],
    tabs: sheetDefinitions.map((definition) => summarizeTab(definition, [])),
    warnings: [message, "MRPI is not present in this crypto workbook and remains a separately published manual reading."]
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
