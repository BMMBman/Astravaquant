import { describe, expect, it } from "vitest";
import { buildPerformanceSeries } from "./performance.js";

describe("portfolio performance", () => {
  it("does not invent history before snapshots exist", () => {
    const result = buildPerformanceSeries(
      [{ timestamp: "2026-08-10T12:00:00.000Z", valueUsd: 1000 }],
      "ALL",
      new Date("2026-08-10T12:00:00.000Z")
    );
    expect(result.status).toBe("insufficient_history");
    expect(result.points).toEqual([]);
  });

  it("calculates changes only from recorded values", () => {
    const result = buildPerformanceSeries(
      [
        { timestamp: "2026-08-01T00:00:00.000Z", valueUsd: 1000 },
        { timestamp: "2026-08-10T00:00:00.000Z", valueUsd: 1125 }
      ],
      "ALL",
      new Date("2026-08-10T00:00:00.000Z")
    );
    expect(result.status).toBe("ready");
    expect(result.changeUsd).toBe(125);
    expect(result.changePct).toBe(12.5);
  });
});
