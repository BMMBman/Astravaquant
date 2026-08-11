import type { WorkbookScorePoint } from "./contracts.js";

export type BacktestRegime = "risk_off" | "neutral" | "risk_on";

export interface BacktestTransition {
  date: string;
  from: BacktestRegime;
  to: BacktestRegime;
  score: number;
}

export interface ScoreBacktestAnalysis {
  observations: number;
  startDate: string | null;
  endDate: string | null;
  currentScore: number | null;
  averageScore: number | null;
  minimumScore: number | null;
  maximumScore: number | null;
  counts: Record<BacktestRegime, number>;
  transitions: BacktestTransition[];
  currentRegime: BacktestRegime | null;
  currentStreak: number;
}

export function classifyScore(score: number, negativeThreshold: number, positiveThreshold: number): BacktestRegime {
  if (score < negativeThreshold) return "risk_off";
  if (score > positiveThreshold) return "risk_on";
  return "neutral";
}

export function analyzeScoreSeries(
  points: WorkbookScorePoint[],
  negativeThreshold = -0.25,
  positiveThreshold = 0.25
): ScoreBacktestAnalysis {
  if (negativeThreshold >= positiveThreshold) throw new Error("The negative threshold must be below the positive threshold.");
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.score))
    .sort((left, right) => left.date.localeCompare(right.date));
  const counts: Record<BacktestRegime, number> = { risk_off: 0, neutral: 0, risk_on: 0 };
  const transitions: BacktestTransition[] = [];
  let previous: BacktestRegime | null = null;
  let currentStreak = 0;

  for (const point of ordered) {
    const regime = classifyScore(point.score, negativeThreshold, positiveThreshold);
    counts[regime] += 1;
    if (previous && regime !== previous) {
      transitions.push({ date: point.date, from: previous, to: regime, score: point.score });
      currentStreak = 1;
    } else {
      currentStreak += 1;
    }
    previous = regime;
  }

  const scores = ordered.map((point) => point.score);
  return {
    observations: ordered.length,
    startDate: ordered[0]?.date ?? null,
    endDate: ordered.at(-1)?.date ?? null,
    currentScore: scores.at(-1) ?? null,
    averageScore: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null,
    minimumScore: scores.length ? Math.min(...scores) : null,
    maximumScore: scores.length ? Math.max(...scores) : null,
    counts,
    transitions,
    currentRegime: previous,
    currentStreak: scores.length ? currentStreak : 0
  };
}
