import type {
  BitcoinValuationDashboard,
  ValuationCategoryId,
  ValuationCategorySummary,
  ValuationIndicator,
  ValuationPoint
} from "../../shared/contracts.js";
import { parseCsv } from "./workbook.js";

type SheetRows = string[][];

interface ValuationWorkbookRanges {
  header: SheetRows;
  indicators: SheetRows;
  summary: SheetRows;
  history: SheetRows;
}

const categoryLabels: Record<ValuationCategoryId, string> = {
  fundamental: "Fundamental",
  technical: "Technical",
  sentiment: "Sentiment"
};

function categoryId(value: string): ValuationCategoryId | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("fundamental")) return "fundamental";
  if (normalized.includes("technical")) return "technical";
  if (normalized.includes("sentiment")) return "sentiment";
  return null;
}

function numberCell(value: string | undefined): number | null {
  if (!value || /^#/.test(value)) return null;
  const parsed = Number(value.replace(/[,$%+]/g, ""));
  return Number.isFinite(parsed) && parsed >= -5 && parsed <= 5 ? parsed : null;
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

export function parseValuationIndicators(rows: SheetRows): ValuationIndicator[] {
  const indicators: ValuationIndicator[] = [];
  let activeCategory: ValuationCategoryId | null = null;

  for (const row of rows) {
    activeCategory = categoryId(row[0] ?? "") ?? activeCategory;
    const name = row[1]?.trim() ?? "";
    const score = numberCell(row[5]);
    if (!activeCategory || !name || score === null) continue;

    indicators.push({
      id: slug(`${activeCategory}-${name}`),
      name,
      category: activeCategory,
      categoryLabel: categoryLabels[activeCategory],
      state: row[2]?.trim() || "Unclassified",
      description: row[3]?.trim() || "",
      score,
      sourceUrl: safeUrl(row[6])
    });
  }

  return indicators;
}

export function parseValuationHistory(rows: SheetRows): ValuationPoint[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /^date$/i.test(cell.trim())));
  let dateIndex = 0;
  let scoreIndex = 1;
  let dataStart = 0;

  if (headerIndex >= 0) {
    const header = rows[headerIndex]!;
    dateIndex = header.findIndex((cell) => /^date$/i.test(cell.trim()));
    scoreIndex = header.findIndex((cell, index) => index !== dateIndex && /z\s*-?\s*score|value\s*score|score/i.test(cell));
    if (scoreIndex < 0) scoreIndex = header.findIndex((cell, index) => index !== dateIndex && Boolean(cell.trim()));
    if (scoreIndex < 0) scoreIndex = dateIndex === 0 ? 1 : 0;
    dataStart = headerIndex + 1;
  }

  const byDate = new Map<string, number>();
  for (const row of rows.slice(dataStart)) {
    const date = normalizedDate(row[dateIndex] ?? "");
    const score = numberCell(row[scoreIndex]);
    if (date && score !== null) byDate.set(date, score);
  }

  return [...byDate.entries()]
    .map(([date, score]) => ({ date, score }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function categoriesFor(indicators: ValuationIndicator[]): ValuationCategorySummary[] {
  return (Object.keys(categoryLabels) as ValuationCategoryId[]).map((id) => {
    const scores = indicators.filter((indicator) => indicator.category === id).map((indicator) => indicator.score);
    return {
      id,
      label: categoryLabels[id],
      indicatorCount: scores.length,
      averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0
    };
  }).filter((category) => category.indicatorCount > 0);
}

function findUpdatedLabel(rows: SheetRows): string | null {
  for (const row of rows) {
    const labelIndex = row.findIndex((cell) => /date\s*updated/i.test(cell));
    if (labelIndex < 0) continue;
    return row.slice(labelIndex + 1).find(Boolean)?.trim() || null;
  }
  return null;
}

export function buildBitcoinValuationDashboard(
  ranges: ValuationWorkbookRanges,
  spreadsheetId: string,
  refreshSeconds: number
): BitcoinValuationDashboard {
  const indicators = parseValuationIndicators(ranges.indicators);
  const calculatedScore = indicators.length
    ? indicators.reduce((sum, indicator) => sum + indicator.score, 0) / indicators.length
    : null;
  const score = numberCell(ranges.summary[0]?.[3]) ?? calculatedScore;
  const invertedScore = numberCell(ranges.summary[1]?.[3]) ?? (score === null ? null : -score);
  const state = ranges.summary[0]?.[5]?.trim() || null;
  const invertedState = ranges.summary[1]?.[5]?.trim() || null;
  const history = parseValuationHistory(ranges.history);
  const warnings: string[] = [];

  if (score !== null && calculatedScore !== null && Math.abs(score - calculatedScore) > 0.01) {
    warnings.push("The published composite differs from the arithmetic mean of the available indicator scores.");
  }
  if (indicators.length < 17) {
    warnings.push(`Only ${indicators.length} of 17 expected valuation inputs are currently readable.`);
  }
  if (history.length < 2) {
    warnings.push("Forward-testing history will appear when the workbook contains at least two dated score observations.");
  }

  return {
    status: score !== null && indicators.length > 0 ? (indicators.length >= 17 ? "ready" : "partial") : "unavailable",
    provider: score !== null || indicators.length > 0 ? "Google Sheets" : null,
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    workbookUpdatedLabel: findUpdatedLabel(ranges.header),
    sourceUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    score,
    calculatedScore,
    invertedScore,
    state,
    invertedState,
    scaleMin: -2,
    scaleMax: 2,
    indicatorCount: indicators.length,
    indicators,
    categories: categoriesFor(indicators),
    historyStatus: history.length >= 2 ? "ready" : "unavailable",
    historyMessage: history.length >= 2 ? null : "No verified dated history is published yet. Forward tests will populate here automatically.",
    history,
    warnings
  };
}

function unavailableDashboard(spreadsheetId: string, refreshSeconds: number): BitcoinValuationDashboard {
  const message = "AstravaQuant could not read the public Bitcoin valuation workbook.";
  return {
    status: "unavailable",
    provider: null,
    updatedAt: new Date().toISOString(),
    refreshSeconds,
    workbookUpdatedLabel: null,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    score: null,
    calculatedScore: null,
    invertedScore: null,
    state: null,
    invertedState: null,
    scaleMin: -2,
    scaleMax: 2,
    indicatorCount: 0,
    indicators: [],
    categories: [],
    historyStatus: "unavailable",
    historyMessage: message,
    history: [],
    warnings: [message]
  };
}

export interface BitcoinValuationProvider {
  getDashboard(): Promise<BitcoinValuationDashboard>;
}

export class PublicGoogleSheetsValuationProvider implements BitcoinValuationProvider {
  private cache: { expiresAt: number; dashboard: BitcoinValuationDashboard } | null = null;

  constructor(
    private readonly spreadsheetId: string,
    private readonly cacheMs: number,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async fetchRange(sheet: string, range: string): Promise<SheetRows> {
    const query = new URLSearchParams({ tqx: "out:csv", headers: "0", sheet, range });
    const response = await this.fetcher(
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.spreadsheetId)}/gviz/tq?${query}`,
      { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok || !response.headers.get("content-type")?.includes("text/csv")) {
      throw new Error("Valuation workbook range unavailable.");
    }
    return parseCsv(await response.text());
  }

  async getDashboard(): Promise<BitcoinValuationDashboard> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.dashboard;
    try {
      const [header, indicators, summary, history] = await Promise.all([
        this.fetchRange("SDCA", "A1:G3"),
        this.fetchRange("SDCA", "A5:G24"),
        this.fetchRange("SDCA", "C28:H29"),
        this.fetchRange("Forward Testing", "A1:Z2000")
      ]);
      const dashboard = buildBitcoinValuationDashboard(
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
}
