import { describe, expect, it, vi } from "vitest";
import type { WorkbookDashboard } from "../../shared/contracts.js";
import {
  buildMrpiDashboard,
  MrpiEnrichedWorkbookProvider,
  parseMrpiHistory,
  parseMrpiIndicators,
  PublicGoogleSheetsMrpiProvider
} from "./mrpi.js";

const indicatorRows = [
  ["Trend", "T3S [Loxx] 1W - 10", "Strong Tightening", "Below trend", "", "-1", "https://example.com/t3s"],
  ["Momentum", "FTKC EMAC 1W - 7 - 8", "Strong Tightening", "Momentum pressure", "", "-0.75", ""],
  ["Trend", "EWMA 1W 14", "Strong Tightening", "Below EWMA", "", "-1", ""],
  ["Momentum", "Normalized KAMA Oscillator 1W 17- 19 -10 -12", "Strong Tightening", "KAMA pressure", "", "-0.75", ""],
  ["Momentum", "EWMA Oscaillator 1W 7 - 18", "Strong Tightening", "EWMA pressure", "", "-0.75", ""],
  ["Trend", "Regularized Moving Average Suite 1W 8 - 18 - 3", "Strong Tightening", "RMA pressure", "", "-0.5", ""]
];

describe("MRPI workbook normalization", () => {
  it("normalizes all six TNX criteria and safe source links", () => {
    const indicators = parseMrpiIndicators(indicatorRows);
    expect(indicators).toHaveLength(6);
    expect(indicators[0]).toMatchObject({
      id: "t3s-loxx-1w-10",
      name: "T3S [Loxx] 1W - 10",
      score: -1,
      sourceUrl: "https://example.com/t3s"
    });
    expect(indicators.at(-1)?.score).toBe(-0.5);
    expect(indicators[4]?.name).toBe("EWMA Oscillator 1W 7 - 18");
  });

  it("keeps only real dated scores and ignores blank future rows", () => {
    expect(parseMrpiHistory([
      ["Date", "TPI Score"],
      ["3/28/26", "-0.83"],
      ["8/10/26", "-0.79"],
      ["8/11/26", ""],
      ["8/12/26", "#N/A"]
    ])).toEqual([
      { date: "2026-03-28", score: -0.83 },
      { date: "2026-08-10", score: -0.79 }
    ]);
  });

  it("publishes the workbook score, independently checks the mean, and labels the regime", () => {
    const dashboard = buildMrpiDashboard({
      header: [["Market Regime Indicator - TNX", "DATE UPDATED:", "August 10 2026"]],
      indicators: indicatorRows,
      summary: [["TNX Regime Score", "", "", "-0.79", "", "Strong Tightening"]],
      history: [["3/28/26", "-0.83"], ["8/10/26", "-0.79"]]
    }, "test-mrpi-workbook-id", 300);

    expect(dashboard.status).toBe("ready");
    expect(dashboard.score).toBe(-0.79);
    expect(dashboard.calculatedScore).toBeCloseTo(-0.7916666667, 8);
    expect(dashboard.state).toBe("Strong Tightening");
    expect(dashboard.workbookUpdatedLabel).toBe("August 10 2026");
    expect(dashboard.historyStatus).toBe("ready");
  });

  it("reads bounded public ranges and caches the normalized dashboard", async () => {
    const csvByRange: Record<string, string> = {
      "A1:H3": '"Market Regime Indicator - TNX","DATE UPDATED:","August 10 2026"',
      "A5:G12": indicatorRows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n"),
      "C12:H12": '"TNX Regime Score","","","-0.79","","Strong Tightening"',
      "A16:B2000": '"3/28/26","-0.83"\n"8/10/26","-0.79"\n"8/11/26",""'
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const range = new URL(String(input)).searchParams.get("range") ?? "";
      return new Response(csvByRange[range] ?? "", { status: 200, headers: { "content-type": "text/csv" } });
    });
    const provider = new PublicGoogleSheetsMrpiProvider("test-mrpi-workbook-id", 300_000, fetcher);

    const first = await provider.getDashboard();
    const second = await provider.getDashboard();

    expect(first.indicators).toHaveLength(6);
    expect(first.history).toHaveLength(2);
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("enriches the shared workbook response without changing the crypto workbook contract", async () => {
    const base: WorkbookDashboard = {
      status: "ready",
      provider: "Google Sheets",
      updatedAt: "2026-08-10T12:00:00.000Z",
      refreshSeconds: 300,
      signals: [{
        id: "mrpi",
        name: "Mortgage Rate Pressure Index",
        value: -0.79,
        state: "TIGHTENING",
        regime: "TIGHTENING REGIME",
        scope: "Weekly mortgage-rate pressure.",
        relevantSymbols: [],
        source: "manual_fallback",
        sourceTab: null,
        updatedLabel: null
      }],
      scoreSeries: [],
      ratioModels: [],
      tabs: [],
      warnings: ["MRPI is not present in this crypto workbook and remains a separately published manual reading."]
    };
    const mrpi = buildMrpiDashboard({
      header: [["DATE UPDATED:", "August 10 2026"]],
      indicators: indicatorRows,
      summary: [["TNX Regime Score", "", "", "-0.79", "", "Strong Tightening"]],
      history: [["3/28/26", "-0.83"], ["8/10/26", "-0.79"]]
    }, "test-mrpi-workbook-id", 300);
    const provider = new MrpiEnrichedWorkbookProvider(
      { getDashboard: async () => base },
      { getDashboard: async () => mrpi }
    );

    const dashboard = await provider.getDashboard();
    expect(dashboard.signals[0]).toMatchObject({
      value: -0.79,
      regime: "STRONG TIGHTENING",
      source: "google_sheets",
      sourceTab: "Weekly LPI"
    });
    expect(dashboard.scoreSeries[0]).toMatchObject({ id: "mrpi", points: mrpi.history });
    expect(dashboard.mrpiSystem?.indicators).toHaveLength(6);
    expect(dashboard.warnings).toEqual([]);
  });
});
