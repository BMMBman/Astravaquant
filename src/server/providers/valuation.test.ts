import { describe, expect, it } from "vitest";
import {
  buildBitcoinValuationDashboard,
  parseValuationHistory,
  parseValuationIndicators
} from "./valuation.js";

const names = [
  "BTC: Supply in Profit Market Bands",
  "Short-Term Holder MVRV Indicator",
  "True Market Mean Price + AVIV Ratio",
  "NUPL",
  "Adjusted MVRV",
  "Puell Multiple",
  "MVRV Pricing Bands",
  "52-Week BTC Sharpe Ratio",
  "BTC RSI",
  "The Mayer Multiple",
  "BTC SOPR Z-Score",
  "BTC Short-Term Holder Supply P/L Ratio",
  "BTC STH Cost Basis Delta",
  "Bitcoin Macro Oscillator (BMO)",
  "Crypto Fear & Greed Index",
  "Google Trends (BTC - 5 Years)",
  "Sentix BTC Sentiment"
];

const scores = [2, 2, 1.5, 0, 2.5, 2, 2, 2, 3, 1.7, 1.5, 2, 1.5, 1.5, 2.5, 2, 1.5];

function indicatorRows(): string[][] {
  return names.map((name, index) => [
    index === 0 ? "Fundamental Category" : index === 7 ? "Technical Category" : index === 14 ? "Sentiment Category" : "",
    name,
    scores[index] === 0 ? "Neutral" : "High Value",
    `Research note ${index + 1}`,
    "",
    String(scores[index]),
    index === 0 ? "https://example.com/source" : ""
  ]);
}

describe("Bitcoin valuation workbook", () => {
  it("normalizes all 17 indicators and preserves the three research categories", () => {
    const indicators = parseValuationIndicators(indicatorRows());
    expect(indicators).toHaveLength(17);
    expect(indicators.filter((indicator) => indicator.category === "fundamental")).toHaveLength(7);
    expect(indicators.filter((indicator) => indicator.category === "technical")).toHaveLength(7);
    expect(indicators.filter((indicator) => indicator.category === "sentiment")).toHaveLength(3);
    expect(indicators[0]?.sourceUrl).toBe("https://example.com/source");
  });

  it("builds the published value score and independently verifies its arithmetic mean", () => {
    const dashboard = buildBitcoinValuationDashboard(
      {
        header: [["SDCA", "DATE UPDATED:", "Dec 22 2025"]],
        indicators: indicatorRows(),
        summary: [
          ["Avg Z Score", "", "", "1.84", "", "High Value"],
          ["Avg Z Score multiplied by -1", "", "", "-1.835294118", "", "No Value"]
        ],
        history: [["Date", "Z Score"], ["", "0"]]
      },
      "test-workbook-id",
      300
    );

    expect(dashboard.status).toBe("ready");
    expect(dashboard.score).toBe(1.84);
    expect(dashboard.calculatedScore).toBeCloseTo(1.835294118, 8);
    expect(dashboard.invertedScore).toBeCloseTo(-1.835294118, 8);
    expect(dashboard.workbookUpdatedLabel).toBe("Dec 22 2025");
    expect(dashboard.categories.map((category) => category.indicatorCount)).toEqual([7, 7, 3]);
    expect(dashboard.historyStatus).toBe("unavailable");
  });

  it("only publishes forward tests that have real dates and scores", () => {
    expect(parseValuationHistory([["Date", "Z Score"], ["", "0"]])).toEqual([]);
    expect(parseValuationHistory([
      ["Date", "Z Score"],
      ["2025-12-22", "1.84"],
      ["2026-01-05", "1.65"]
    ])).toEqual([
      { date: "2025-12-22", score: 1.84 },
      { date: "2026-01-05", score: 1.65 }
    ]);
  });

  it("rejects non-HTTPS indicator source links", () => {
    const rows = indicatorRows();
    rows[0]![6] = "javascript:alert(1)";
    expect(parseValuationIndicators(rows)[0]?.sourceUrl).toBeNull();
  });
});
