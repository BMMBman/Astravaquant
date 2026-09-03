import type { ModelSignal, PersonalizedResearch } from "../../shared/contracts.js";

const broadCryptoSymbols = ["BTC", "WBTC", "ETH", "WETH", "HYPE", "LINK", "SOL", "SUI"];

export const currentSignals: ModelSignal[] = [
  {
    id: "mtpi",
    name: "Medium-Term Trend",
    value: 0.47,
    state: "LONG",
    scope: "Five-day aggregate of total crypto market cap and TOTAL2.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "ltpi",
    name: "Long-Term Trend",
    value: -0.95,
    state: "SHORT",
    scope: "Weekly aggregate of total crypto market cap and Bitcoin.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "nspi",
    name: "NSPI",
    value: -0.24,
    state: "NEUTRAL TRANSITION",
    scope: "Aggregate of the medium-term and long-term crypto trend.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "mrpi",
    name: "Mortgage Rate Pressure Index",
    value: -0.79,
    state: "STRONG TIGHTENING",
    scope: "Weekly 10-year Treasury pressure model, read as tightening versus easing.",
    relevantSymbols: []
  }
];
export const researchLibrary: Omit<PersonalizedResearch, "relevance">[] = [
  {
    id: "crypto-medium-term",
    title: "Medium-Term Crypto Participation",
    summary: "The five-day MTPI combines total crypto market cap and TOTAL2 into the current tactical regime.",
    href: "research-crypto-participation.html",
    symbols: broadCryptoSymbols
  },
  {
    id: "crypto-long-term",
    title: "Weekly Crypto Structure",
    summary: "LTPI places broad crypto exposure against the weekly total-market and Bitcoin trend.",
    href: "research-weekly-structure.html",
    symbols: broadCryptoSymbols
  },
  {
    id: "eth-btc-relative-strength",
    title: "ETH / BTC Relative Strength",
    summary: "The relative-strength workspace is prepared for the first ETH/BTC ratio feed without publishing placeholder signals.",
    href: "research.html#relative-strength",
    symbols: ["ETH", "WETH", "BTC", "WBTC"]
  }
];
