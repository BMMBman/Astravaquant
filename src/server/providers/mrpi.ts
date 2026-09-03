import type {
  MrpiDashboard,
  MrpiIndicator,
  WorkbookDashboard,
  WorkbookModelSignal,
  WorkbookSignalSnapshot,
  WorkbookScorePoint,
  WorkbookScoreSeries
} from "../../shared/contracts.js";
import { currentSignals } from "../data/astrava.js";
import { parseCsv, type WorkbookProvider, workbookSignalSnapshot } from "./workbook.js";

type SheetRows = string[][];

interface MrpiWorkbookRanges {
  header: SheetRows;
  indicators: SheetRows;
  summary: SheetRows;
  history: SheetRows;
}

function numberCell(value: string | undefined): number | null {
  if (!value || /^#/.test(value)) return null;
  const parsed = Number(value.replace(/[,$%+]/g, ""));
  return Number.isFinite(parsed) && parsed >= -1 && parsed <= 1 ? parsed : null;
}

function normalizedDate(value: string): string | null {
  if (!value || !/\d/.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function updatedLabel(rows: SheetRows): string | null {
  for (const row of rows) {
    const labelIndex = row.findIndex((cell) => /date\s*updated/i.test(cell));
    if (labelIndex < 0) continue;
    return row.slice(labelIndex + 1).find(Boolean)?.trim() || null;
  }
  return null;
}

export function mrpiStateForScore(score: number): string {
  if (score <= -0.75) return "STRONG TIGHTENING";
  if (score < -0.25) return "TIGHTENING";
  if (score <= 0.25) return "NEUTRAL";
  if (score < 0.75) return "EASING";
  return "STRONG EASING";
}

export function parseMrpiIndicators(rows: SheetRows): MrpiIndicator[] {
  return rows.flatMap((row) => {
    const name = (row[1]?.trim() ?? "").replace(/\bOscaillator\b/gi, "Oscillator");
    const score = numberCell(row[5]);
    if (!name || score === null) return [];
    return [{
      id: slug(name),
      name,
      state: row[2]?.trim() || mrpiStateForScore(score),
      description: row[3]?.trim() || "",
      score,
      sourceUrl: safeUrl(row[6])
    }];
  });
}

export function parseMrpiHistory(rows: SheetRows): WorkbookScorePoint[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /^date$/i.test(cell.trim())));
  const dataStart = headerIndex >= 0 ? headerIndex + 1 : 0;
  const byDate = new Map<string, number>();
  for (const row of rows.slice(dataStart)) {
    const date = normalizedDate(row[0] ?? "");
    const score = numberCell(row[1]);
    if (date && score !== null) byDate.set(date, score);
  }
  return [...byDate.entries()]
    .map(([date, score]) => ({ date, score }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function buildMrpiDashboard(
  ranges: MrpiWorkbookRanges,
  spreadsheetId: string,
  refreshSeconds: number
): MrpiDashboard {
  const indicators = parseMrpiIndicators(ranges.indicators);
  const calculatedScore = indicators.length
    ? indicators.reduce((sum, indicator) => sum + indicator.score, 0) / indicators.length
    : null;
  const score = numberCell(ranges.summary[0]?.[3]) ?? calculatedScore;
  const state = ranges.summary[0]?.[5]?.trim() || (score === null ? null : mrpiStateForScore(score));
  const history = parseMrpiHistory(ranges.history);
  const warnings: string[] = [];
  if (score !== null && calculatedScore !== null && Math.abs(score - calculatedScore) > 0.01) {
    warnings.push("The published MRPI score differs from the arithmetic mean of the available criteria.");
  }
  if (indicators.length < 6) warnings.push(`Only ${indicators.length} of 6 expected MRPI criteria are currently readable.`);
  if (history.length < 2) warnings.push("MRPI history needs at least two dated scores to form a line.");
  return {
    status: score !== null && indicators.length > 0 ? (indicators.length >= 6 ? "ready" : "partial") : "unavailable",
    provider: score !== null || indicators.length > 0 ? "Google Sheets" : null,
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    workbookUpdatedLabel: updatedLabel(ranges.header),
    sourceUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    score,
    calculatedScore,
    state,
    indicatorCount: indicators.length,
    indicators,
    historyStatus: history.length > 1 ? "ready" : "unavailable",
    historyMessage: history.length > 1 ? null : "No verified MRPI history is published yet.",
    history,
    warnings
  };
}

function unavailableDashboard(spreadsheetId: string, refreshSeconds: number): MrpiDashboard {
  const message = "AstravaQuant could not read the public MRPI workbook.";
  return {
    status: "unavailable",
    provider: null,
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    workbookUpdatedLabel: null,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    score: null,
    calculatedScore: null,
    state: null,
    indicatorCount: 0,
    indicators: [],
    historyStatus: "unavailable",
    historyMessage: message,
    history: [],
    warnings: [message]
  };
}

export interface MrpiProvider {
  getDashboard(): Promise<MrpiDashboard>;
  getSignalDashboard?(): Promise<MrpiDashboard>;
}

export class PublicGoogleSheetsMrpiProvider implements MrpiProvider {
  private cache: { expiresAt: number; dashboard: MrpiDashboard } | null = null;
  private signalCache: { expiresAt: number; dashboard: MrpiDashboard } | null = null;

  private get signalCacheMs(): number {
    return Math.min(this.cacheMs, 60_000);
  }

  constructor(
    private readonly spreadsheetId: string,
    private readonly cacheMs: number,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async fetchRange(range: string): Promise<SheetRows> {
    const query = new URLSearchParams({ tqx: "out:csv", headers: "0", sheet: "Weekly LPI", range });
    const response = await this.fetcher(
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.spreadsheetId)}/gviz/tq?${query}`,
      { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok || !response.headers.get("content-type")?.includes("text/csv")) {
      throw new Error("MRPI workbook range unavailable.");
    }
    return parseCsv(await response.text());
  }

  async getDashboard(): Promise<MrpiDashboard> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.dashboard;
    try {
      const [header, indicators, summary, history] = await Promise.all([
        this.fetchRange("A1:H3"),
        this.fetchRange("A5:G12"),
        this.fetchRange("C12:H12"),
        this.fetchRange("A16:B2000")
      ]);
      const dashboard = buildMrpiDashboard(
        { header, indicators, summary, history },
        this.spreadsheetId,
        Math.round(this.cacheMs / 1000)
      );
      this.cache = { expiresAt: Date.now() + this.cacheMs, dashboard };
      return dashboard;
    } catch {
      return unavailableDashboard(this.spreadsheetId, Math.round(this.cacheMs / 1000));
    }
  }

  async getSignalDashboard(): Promise<MrpiDashboard> {
    if (this.cache && this.cache.expiresAt - this.cacheMs + this.signalCacheMs > Date.now()) {
      return { ...this.cache.dashboard, refreshSeconds: Math.round(this.signalCacheMs / 1000) };
    }
    if (this.signalCache && this.signalCache.expiresAt > Date.now()) return this.signalCache.dashboard;
    try {
      const [header, summary] = await Promise.all([
        this.fetchRange("A1:H3"),
        this.fetchRange("C12:H12")
      ]);
      const dashboard = buildMrpiDashboard(
        { header, indicators: [], summary, history: [] },
        this.spreadsheetId,
        Math.round(this.signalCacheMs / 1000)
      );
      const signalDashboard: MrpiDashboard = {
        ...dashboard,
        status: dashboard.score === null ? "unavailable" : "ready",
        warnings: dashboard.score === null ? dashboard.warnings : []
      };
      if (signalDashboard.status !== "unavailable") {
        this.signalCache = { expiresAt: Date.now() + this.signalCacheMs, dashboard: signalDashboard };
      }
      return signalDashboard;
    } catch {
      return unavailableDashboard(this.spreadsheetId, Math.round(this.cacheMs / 1000));
    }
  }
}

function mrpiSeries(dashboard: MrpiDashboard): WorkbookScoreSeries {
  return {
    id: "mrpi",
    label: "Mortgage Rate Pressure Index",
    sourceTab: "Weekly LPI",
    status: dashboard.historyStatus,
    message: dashboard.historyMessage,
    points: dashboard.history
  };
}

function mrpiSignal(dashboard: MrpiDashboard, fallback: WorkbookModelSignal): WorkbookModelSignal {
  if (dashboard.score === null) return fallback;
  const state = (dashboard.state ?? mrpiStateForScore(dashboard.score)).toUpperCase();
  return {
    ...fallback,
    value: dashboard.score,
    state,
    regime: state,
    source: "google_sheets",
    sourceTab: "Weekly LPI",
    // Use the last dated history observation when available instead of a stale sheet-header date.
    updatedLabel: dashboard.history.at(-1)?.date ?? dashboard.workbookUpdatedLabel
  };
}

export class MrpiEnrichedWorkbookProvider implements WorkbookProvider {
  constructor(
    private readonly baseProvider: WorkbookProvider,
    private readonly mrpiProvider: MrpiProvider
  ) {}

  async getDashboard(): Promise<WorkbookDashboard> {
    const [base, mrpi] = await Promise.all([
      this.baseProvider.getDashboard(),
      this.mrpiProvider.getDashboard()
    ]);
    const fallback = base.signals.find((signal) => signal.id === "mrpi") ?? {
      ...currentSignals.find((signal) => signal.id === "mrpi")!,
      regime: "TIGHTENING REGIME",
      source: "manual_fallback" as const,
      sourceTab: null,
      updatedLabel: null
    };
    const signal = mrpiSignal(mrpi, fallback);
    const signals = base.signals.some((candidate) => candidate.id === "mrpi")
      ? base.signals.map((candidate) => candidate.id === "mrpi" ? signal : candidate)
      : [...base.signals, signal];
    const warnings = base.warnings.filter((warning) => !/^MRPI (?:is not present|is sourced)/i.test(warning));
    if (mrpi.status === "unavailable") warnings.push("The separate MRPI workbook is temporarily unavailable; the published fallback reading remains visible.");
    return {
      ...base,
      signals,
      scoreSeries: [...base.scoreSeries.filter((series) => series.id !== "mrpi"), mrpiSeries(mrpi)],
      warnings,
      mrpiSystem: mrpi
    };
  }

  async getSignalSnapshot(): Promise<WorkbookSignalSnapshot> {
    const [base, mrpi] = await Promise.all([
      this.baseProvider.getSignalSnapshot?.()
        ?? this.baseProvider.getDashboard().then(workbookSignalSnapshot),
      this.mrpiProvider.getSignalDashboard?.()
        ?? this.mrpiProvider.getDashboard()
    ]);
    const fallback = base.signals.find((signal) => signal.id === "mrpi") ?? {
      ...currentSignals.find((signal) => signal.id === "mrpi")!,
      regime: "TIGHTENING REGIME",
      source: "manual_fallback" as const,
      sourceTab: null,
      updatedLabel: null
    };
    const signal = mrpiSignal(mrpi, fallback);
    const signals = base.signals.some((candidate) => candidate.id === "mrpi")
      ? base.signals.map((candidate) => candidate.id === "mrpi" ? signal : candidate)
      : [...base.signals, signal];
    const publishedCount = signals.filter((candidate) => candidate.source !== "manual_fallback").length;
    return {
      ...base,
      status: publishedCount === signals.length ? "ready" : publishedCount > 0 ? "partial" : "unavailable",
      provider: publishedCount > 0 ? "Google Sheets" : null,
      updatedAt: new Date().toISOString(),
      signals
    };
  }
}
