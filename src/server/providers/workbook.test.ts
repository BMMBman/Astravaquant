import { describe, expect, it, vi } from "vitest";
import { buildWorkbookDashboard, buildWorkbookSignalSnapshot, parseCsv, parseRatioModels, parseScoreSeries, PublicGoogleSheetsWorkbookProvider, regimeForScore } from "./workbook.js";

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

  it("publishes the two trend models without changing MRPI", () => {
    const dashboard = buildWorkbookDashboard(
      new Map([
        ["Medium-Term Trend (MTTPM)", [["DATE UPDATED:", "June 4 2026"], ["MTPI Avg Score", "0.21", "Long Biased"]]],
        ["Long-Term Trend (LTTPM)", [["DATE UPDATED:", "June 4 2026"], ["LTPI Avg Score", "-0.89", "Short"]]],
        ["Medium-Term Forward Testing", [["Date", "TPI Score"], ["8/4/2025", "0.1"], ["8/5/2025", "0.2"]]],
        ["Long-Term Forward Testing", [["Date", "TPI Score"], ["11/26/2025", "-0.8"], ["12/3/2025", "-0.9"]]]
      ]),
      300
    );

    expect(dashboard.status).toBe("partial");
    expect(dashboard.signals.find((signal) => signal.id === "mtpi")).toMatchObject({
      value: 0.21,
      state: "LONG BIASED",
      regime: "NEUTRAL TRANSITION",
      source: "google_sheets"
    });
    expect(dashboard.signals.find((signal) => signal.id === "mrpi")).toMatchObject({
      value: -0.79,
      source: "manual_fallback"
    });
  });

  it("builds a lightweight signal snapshot from only the two core score ranges", () => {
    const snapshot = buildWorkbookSignalSnapshot(new Map([
      ["Medium-Term Trend (MTTPM)", [["DATE UPDATED:", "Aug 11 2026"], ["MTPI Avg Score", "-0.58", "Short"]]],
      ["Long-Term Trend (LTTPM)", [["DATE UPDATED:", "Aug 11 2026"], ["LTPI Avg Score", "-0.89", "Short"]]]
    ]), 300);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.signals.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: "mtpi", value: -0.58 },
      { id: "ltpi", value: -0.89 },
      { id: "mrpi", value: -0.79 }
    ]);
  });

  it("fetches only bounded MTPI and LTPI ranges for the homepage snapshot", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const sheet = url.searchParams.get("sheet");
      const csv = sheet === "MT"
        ? '"DATE UPDATED:","Aug 11 2026"\n"MTPI Avg Score","-0.58","Short"'
        : '"DATE UPDATED:","Aug 11 2026"\n"LTPI Avg Score","-0.89","Short"';
      return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
    });
    const provider = new PublicGoogleSheetsWorkbookProvider("test-workbook-id", 300_000, fetcher);

    const first = await provider.getSignalSnapshot();
    const second = await provider.getSignalSnapshot();

    expect(first.signals.map((signal) => signal.id)).not.toContain("nspi");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("sheet"))).toEqual(["MT", "LT"]);
    expect(fetcher.mock.calls.every(([input]) => new URL(String(input)).searchParams.get("range") === "A1:AZ100")).toBe(true);
  });

  it("uses the documented shared regime bands", () => {
    expect(regimeForScore(-0.8)).toBe("EXTREME RISK-OFF");
    expect(regimeForScore(-0.4)).toBe("DEFENSIVE CONTRACTION");
    expect(regimeForScore(0.2)).toBe("NEUTRAL TRANSITION");
    expect(regimeForScore(0.6)).toBe("CONSTRUCTIVE EXPANSION");
    expect(regimeForScore(0.9)).toBe("FULL RISK-ON");
  });
});
