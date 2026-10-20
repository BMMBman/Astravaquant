import type { ModelSignal, PersonalizedResearch } from "../../shared/contracts.js";

const broadCryptoSymbols = ["BTC", "WBTC", "ETH", "WETH", "HYPE", "LINK", "SOL", "SUI"];

export const currentSignals: ModelSignal[] = [
  {
    id: "sniper1d",
    name: "Total ES 1D",
    value: -1,
    state: "SHORT",
    scope: "Daily Total ES trend model from the 1D SNIPER V1 system.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "mtpi",
    name: "MTPI Total",
    value: -1,
    state: "SHORT",
    scope: "Medium-term total-market trend model.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "btc1w",
    name: "BTC 1W",
    value: 1,
    state: "LONG",
    scope: "Bitcoin one-week trend model.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "ltpi",
    name: "Long-Term Trend",
    value: 0.89,
    state: "LONG",
    scope: "Long-term aggregate of total crypto market cap and Bitcoin.",
    relevantSymbols: broadCryptoSymbols
  },
  {
    id: "mrpi",
    name: "10US Treasury Module",
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
    summary: "The Total ES 1D and MTPI Total systems separate daily tactical and medium-term total-market regimes.",
    href: "research-crypto-participation.html",
    symbols: broadCryptoSymbols
  },
  {
    id: "crypto-long-term",
    title: "Weekly Crypto Structure",
    summary: "The BTC 1W and Long-Term Trend systems separate Bitcoin tactical structure from the longer-horizon regime.",
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
