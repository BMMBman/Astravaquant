import type {
  PerformancePeriod,
  PerformancePoint,
  PerformanceSeries
} from "../../shared/contracts.js";

export const performancePeriods: PerformancePeriod[] = ["1D", "7D", "1M", "3M", "YTD", "1Y", "ALL"];

function periodStart(period: PerformancePeriod, now: Date): Date | null {
  const start = new Date(now);
  if (period === "1D") start.setUTCDate(start.getUTCDate() - 1);
  if (period === "7D") start.setUTCDate(start.getUTCDate() - 7);
  if (period === "1M") start.setUTCMonth(start.getUTCMonth() - 1);
  if (period === "3M") start.setUTCMonth(start.getUTCMonth() - 3);
  if (period === "YTD") return new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  if (period === "1Y") start.setUTCFullYear(start.getUTCFullYear() - 1);
  return period === "ALL" ? null : start;
}
function sample(points: PerformancePoint[], maximum = 96): PerformancePoint[] {
  if (points.length <= maximum) {
    return points;
  }

  const sampled: PerformancePoint[] = [];
  const step = (points.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1) {
    sampled.push(points[Math.round(index * step)]!);
  }
  return sampled;
}

export function buildPerformanceSeries(
  allPoints: PerformancePoint[],
  period: PerformancePeriod,
  now = new Date()
): PerformanceSeries {
  const cutoff = periodStart(period, now);
  let points = allPoints;

  if (cutoff) {
    const cutoffMs = cutoff.getTime();
    const baseline = [...allPoints].reverse().find((point) => new Date(point.timestamp).getTime() <= cutoffMs);
    if (!baseline) {
      points = [];
    } else {
      points = [baseline, ...allPoints.filter((point) => new Date(point.timestamp).getTime() > cutoffMs)];
    }
  }

  if (points.length < 2) {
    return {
      period,
      status: "insufficient_history",
      message: "Performance history begins with real portfolio snapshots after wallet authentication.",
      startValueUsd: null,
      endValueUsd: null,
      changeUsd: null,
      changePct: null,
      points: []
    };
  }

  const startValueUsd = points[0]!.valueUsd;
  const endValueUsd = points[points.length - 1]!.valueUsd;
  const changeUsd = endValueUsd - startValueUsd;
  const changePct = startValueUsd > 0 ? (changeUsd / startValueUsd) * 100 : null;

  return {
    period,
    status: "ready",
    message: null,
    startValueUsd,
    endValueUsd,
    changeUsd,
    changePct,
    points: sample(points)
  };
}

export function buildAllPerformanceSeries(points: PerformancePoint[], now = new Date()) {
  return Object.fromEntries(
    performancePeriods.map((period) => [period, buildPerformanceSeries(points, period, now)])
  ) as Record<PerformancePeriod, PerformanceSeries>;
}
