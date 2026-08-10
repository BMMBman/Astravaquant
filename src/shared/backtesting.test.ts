import { describe, expect, it } from "vitest";
import { analyzeScoreSeries, classifyScore } from "./backtesting.js";

describe("score-series diagnostics", () => {
  it("classifies scores against adjustable thresholds", () => {
    expect(classifyScore(-0.26, -0.25, 0.25)).toBe("risk_off");
    expect(classifyScore(0.25, -0.25, 0.25)).toBe("neutral");
    expect(classifyScore(0.26, -0.25, 0.25)).toBe("risk_on");
  });

  it("measures distributions, transitions, and the current streak", () => {
    const analysis = analyzeScoreSeries([
      { date: "2025-01-01", score: -0.4 },
      { date: "2025-01-02", score: 0 },
      { date: "2025-01-03", score: 0.6 },
      { date: "2025-01-04", score: 0.7 }
    ]);

    expect(analysis.counts).toEqual({ risk_off: 1, neutral: 1, risk_on: 2 });
    expect(analysis.transitions).toHaveLength(2);
    expect(analysis.currentRegime).toBe("risk_on");
    expect(analysis.currentStreak).toBe(2);
    expect(analysis.averageScore).toBeCloseTo(0.225);
  });
});
