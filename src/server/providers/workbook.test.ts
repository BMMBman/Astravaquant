import { describe, expect, it, vi } from "vitest";
import { buildWorkbookDashboard, buildWorkbookSignalSnapshot, parseCsv, parseModelResults, parseRatioModels, parseScoreSeries, PublicGoogleSheetsWorkbookProvider, regimeForScore } from "./workbook.js";

describe("Google workbook normalization", () => {
  it("reads dated score observations and excludes blanks and formula errors", () => {
    const series = parseScoreSeries("mtpi", "MT Total Forward Testing", [
      ["Date", "MTPI Score"],
      ["8/4/2025", "0.22"],
      ["8/5/2025", "#N/A"],
      ["8/6/2025", "-0.41"],
      ["", ""]
    ]);

    expect(series.status).toBe("ready");
    expect(series.points).toEqual([
      { date: "2025-08-04", score: 0.22 },
      { date: "2025-08-06", score: -0.41 }
    ]);
  });

  it("infers public CSV score columns when Google removes the header row", () => {
    const rows = parseCsv('"8/4/25","0.56",""\n"8/5/25","-0.12",""\n');
    const series = parseScoreSeries("mtpi", "MT Total Forward Testing", rows);
    expect(series.status).toBe("ready");
    expect(series.points).toEqual([
      { date: "2025-08-04", score: 0.56 },
      { date: "2025-08-05", score: -0.12 }
    ]);
  });

  it("parses quoted commas and escaped quotes without altering cells", () => {
    expect(parseCsv('"Model, Core","A ""quoted"" cell"\n')).toEqual([["Model, Core", 'A "quoted" cell']]);
  });

  it("extracts the latest relative-strength summary", () => {
    const ratios = parseRatioModels("SMPS", [
      ["ETHBTC Avg Score", "0.33", "Long"],
      ["ETHBTC Avg Score", "-0.55", "Short"],
      ["SUI/SOL Avg Score", "-0.71", "Short"]
    ]);

    expect(ratios).toEqual([
      { id: "eth-btc", label: "ETH / BTC", score: -0.55, state: "SHORT", sourceTab: "SMPS" },
      { id: "sui-sol", label: "SUI / SOL", score: -0.71, state: "SHORT", sourceTab: "SMPS" }
    ]);
  });

  it("reads block-style relative-strength summaries from the public export", () => {
    const ratios = parseRatioModels("SMPS", [
      ["", "", "SOLETH TPI"],
      ["", "Indicator", "2D", "18 - 3", "1", "Bullish"],
      ["", "", "", "", "", "0.88", "Neutral", "ETH", "20%"],
      ["", "", "ETHBTC TPI"],
      ["", "", "", "", "", "-1.00", "BITCOIN", "BTC", "80%"],
      ["", "", "SUISOL TPI"],
      ["", "", "", "", "", "-0.71", "Short", "SOL", "80%"]
    ]);
    expect(ratios).toEqual([
      { id: "sol-eth", label: "SOL / ETH", score: 0.88, state: "NEUTRAL", sourceTab: "SMPS" },
      { id: "eth-btc", label: "ETH / BTC", score: -1, state: "SHORT", sourceTab: "SMPS" },
      { id: "sui-sol", label: "SUI / SOL", score: -0.71, state: "SHORT", sourceTab: "SMPS" }
    ]);
  });

  it("publishes four independently sourced trend models without changing MRPI", () => {
    const dashboard = buildWorkbookDashboard(
      new Map([
        ["Total ES 1D", [["DATE UPDATED:", "Oct 20 2026"], ["SNIPER Composite Score", "-1", "Short"]]],
        ["MTPI Total", [["DATE UPDATED:", "Oct 20 2026"], ["MTPI Avg Score", "-1", "Short"]]],
        ["BTC 1W", [["DATE UPDATED:", "Oct 20 2026"], ["BTC Avg Score", "1", "Long"]]],
        ["Long-Term Trend", [["DATE UPDATED:", "Oct 20 2026"], ["LTPI Avg Score", "0.89", "Long"]]],
        ["Total ES 1D Forward Test", [["Date", "TPI Score"], ["10/19/2026", "-1"], ["10/20/2026", "-1"]]],
        ["MTPI Total Forward Test", [["Date", "TPI Score"], ["10/19/2026", "-1"], ["10/20/2026", "-1"]]],
        ["BTC 1W Forward Test", [["Date", "TPI Score"], ["10/20/2026", ""]]],
        ["Long-Term Forward Test", [["Date", "TPI Score"], ["10/19/2026", "0.88"], ["10/20/2026", "0.89"]]]
      ]),
      300
    );

    expect(dashboard.status).toBe("partial");
    expect(dashboard.signals.find((signal) => signal.id === "sniper1d")).toMatchObject({
      name: "Total ES 1D",
      value: -1,
      state: "RISK-OFF",
      regime: "RISK-OFF",
      source: "google_sheets",
      sourceTab: "1D SNIPER V1"
    });
    expect(dashboard.signals.find((signal) => signal.id === "btc1w")).toMatchObject({
      name: "BTC 1W",
      value: 1,
      sourceTab: "New BTC"
    });
    expect(dashboard.scoreSeries.find((series) => series.id === "sniper1d")).toMatchObject({
      label: "Total ES 1D",
      sourceTab: "SNIPER V1 Forward Testing"
    });
    expect(dashboard.scoreSeries.find((series) => series.id === "btc1w")).toMatchObject({
      label: "BTC 1W",
      sourceTab: "BTC 6D Forward Testing",
      status: "unavailable"
    });
    expect(dashboard.signals.find((signal) => signal.id === "mrpi")).toMatchObject({
      value: -0.79,
      source: "manual_fallback"
    });
  });

  it("builds a lightweight signal snapshot from all four core score ranges", () => {
    const snapshot = buildWorkbookSignalSnapshot(new Map([
      ["Total ES 1D", [["DATE UPDATED:", "Oct 20 2026"], ["SNIPER Composite Score", "-1", "Short"]]],
      ["MTPI Total", [["DATE UPDATED:", "Oct 20 2026"], ["MTPI Avg Score", "-1", "Short"]]],
      ["BTC 1W", [["DATE UPDATED:", "Oct 20 2026"], ["BTC Avg Score", "1", "Long"]]],
      ["Long-Term Trend", [["DATE UPDATED:", "Oct 20 2026"], ["LTPI Avg Score", "0.89", "Long"]]]
    ]), 300);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.signals.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: "sniper1d", value: -1 },
      { id: "mtpi", value: -1 },
      { id: "btc1w", value: 1 },
      { id: "ltpi", value: 0.89 },
      { id: "mrpi", value: -0.79 }
    ]);
  });

  it("fetches only bounded ranges for the four homepage signals", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const sheet = url.searchParams.get("sheet");
      const csvBySheet: Record<string, string> = {
        "1D SNIPER V1": '"DATE UPDATED:","Oct 20 2026"\n"SNIPER Composite Score","-1","Short"',
        MTPI: '"DATE UPDATED:","Oct 20 2026"\n"MTPI Avg Score","-1","Short"',
        "New BTC": '"DATE UPDATED:","Oct 20 2026"\n"BTC Avg Score","1","Long"',
        LT: '"DATE UPDATED:","Oct 20 2026"\n"LTPI Avg Score","0.89","Long"'
      };
      const csv = csvBySheet[sheet ?? ""] ?? "";
      return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
    });
    const provider = new PublicGoogleSheetsWorkbookProvider("test-workbook-id", 300_000, fetcher);

    const first = await provider.getSignalSnapshot();
    const second = await provider.getSignalSnapshot();

    expect(first.signals.map((signal) => signal.id)).not.toContain("nspi");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("sheet"))).toEqual(["1D SNIPER V1", "MTPI", "New BTC", "LT"]);
    expect(fetcher.mock.calls.every(([input]) => new URL(String(input)).searchParams.get("range") === "A1:AZ100")).toBe(true);
  });

  it("preserves published backtest values and review flags", () => {
    const results = parseModelResults([
      ["MODEL BACKTEST RESULTS"],
      ["As of", "2026-10-17", "Models", "3", "Tests", "14", "Best Net Profit", "136644.96%", "Best Sharpe", "1.47", "Best Profit Factor", "20.32", "Review Flags", "3"],
      ["Historical simulated results"],
      ["Model", "Timeframe", "Window", "Start Date", "End / As-of", "Net Profit", "Max Equity DD", "Max Intratrade DD", "Profit Factor", "Win Rate", "Sharpe", "Sortino", "Omega", "Half Kelly", "Trades", "Source / Notes", "Review Status"],
      ["TOTALES", "1D", "Rolling 36 months", "2023-10-17", "2026-10-17", "191.15%", "-27.16%", "-22.44%", "3.88", "58.33%", "0.73", "1.09", "1.3", "36.44%", "12", "Published", "Complete"]
    ]);
    expect(results).toMatchObject({ status: "ready", testCount: 14, reviewFlags: 3, bestSharpe: "1.47" });
    expect(results.results[0]).toMatchObject({ model: "TOTALES", netProfit: "191.15%", reviewStatus: "Complete" });
  });

  it("uses the documented shared regime bands", () => {
    expect(regimeForScore(-0.8)).toBe("EXTREME RISK-OFF");
    expect(regimeForScore(-0.4)).toBe("DEFENSIVE CONTRACTION");
    expect(regimeForScore(0.2)).toBe("NEUTRAL TRANSITION");
    expect(regimeForScore(0.6)).toBe("CONSTRUCTIVE EXPANSION");
    expect(regimeForScore(0.9)).toBe("FULL RISK-ON");
  });
});
