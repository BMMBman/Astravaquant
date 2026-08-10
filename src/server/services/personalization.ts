import type {
  AllocationContext,
  ModelSignal,
  PersonalizedResearch,
  PortfolioHolding
} from "../../shared/contracts.js";
import { currentSignals, researchLibrary } from "../data/astrava.js";

function normalizedSymbol(symbol: string): string {
  if (symbol === "WETH") return "ETH";
  if (symbol === "WBTC") return "BTC";
  return symbol;
}
function allocationBySymbol(holdings: PortfolioHolding[]): Map<string, number> {
  const allocations = new Map<string, number>();
  for (const holding of holdings) {
    if (holding.allocationPct === null) continue;
    const symbol = normalizedSymbol(holding.symbol);
    allocations.set(symbol, (allocations.get(symbol) ?? 0) + holding.allocationPct);
  }
  return allocations;
}

export function relevantSignals(holdings: PortfolioHolding[]): ModelSignal[] {
  const heldSymbols = new Set(holdings.map((holding) => normalizedSymbol(holding.symbol)));
  if (heldSymbols.size === 0) {
    return currentSignals.filter((signal) => signal.id === "nspi");
  }

  return currentSignals.filter((signal) =>
    signal.relevantSymbols.some((symbol) => heldSymbols.has(normalizedSymbol(symbol)))
  );
}

export function relevantResearch(holdings: PortfolioHolding[]): PersonalizedResearch[] {
  const allocations = allocationBySymbol(holdings);
  return researchLibrary
    .map((research) => ({
      ...research,
      relevance: research.symbols.reduce(
        (total, symbol) => total + (allocations.get(normalizedSymbol(symbol)) ?? 0),
        0
      )
    }))
    .filter((research) => research.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
}

export function allocationContext(holdings: PortfolioHolding[]): AllocationContext {
  const portfolio = [...allocationBySymbol(holdings).entries()]
    .map(([symbol, allocationPct]) => ({ symbol, allocationPct }))
    .sort((a, b) => b.allocationPct - a.allocationPct);

  return {
    status: "unpublished",
    message: "AstravaQuant target allocations have not been published. Your real allocation is shown without invented model weights.",
    portfolio,
    model: [],
    differences: []
  };
}

export function portfolioRegime(): ModelSignal {
  return currentSignals.find((signal) => signal.id === "nspi")!;
}
