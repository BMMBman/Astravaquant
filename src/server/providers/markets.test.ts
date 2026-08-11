import { describe, expect, it } from "vitest";
import { PublicMarketProvider } from "./markets.js";

function response(body: string | object, contentType = "application/json"): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": contentType }
  });
}

function successfulFetcher() {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/simple/price")) {
      return response({
        bitcoin: { usd: 100_000, usd_market_cap: 2_000_000, usd_24h_change: 2, last_updated_at: 1_700_000_000 },
        ethereum: { usd: 4_000, usd_market_cap: 500_000, usd_24h_change: -1, last_updated_at: 1_700_000_000 },
        solana: { usd: 180, usd_market_cap: 80_000, usd_24h_change: 3, last_updated_at: 1_700_000_000 },
        sui: { usd: 3.5, usd_market_cap: 10_000, usd_24h_change: 4, last_updated_at: 1_700_000_000 },
        hyperliquid: { usd: 45, usd_market_cap: 12_000, usd_24h_change: -2, last_updated_at: 1_700_000_000 }
      });
    }
    if (url.endsWith("/global")) {
      return response({ data: { total_market_cap: { usd: 3_000_000 }, market_cap_change_percentage_24h_usd: 1, updated_at: 1_700_000_000 } });
    }
    if (url.includes("/coins/bitcoin/")) return response({ prices: [[1_700_000_000_000, 90_000], [1_700_086_400_000, 100_000]] });
    if (url.includes("/coins/ethereum/")) return response({ prices: [[1_700_000_000_000, 4_100], [1_700_086_400_000, 4_000]] });
    if (url.includes("/coins/solana/")) return response({ prices: [[1_700_000_000_000, 170], [1_700_086_400_000, 180]] });
    if (url.includes("/coins/sui/")) return response({ prices: [[1_700_000_000_000, 3.2], [1_700_086_400_000, 3.5]] });
    if (url.includes("/coins/hyperliquid/")) return response({ prices: [[1_700_000_000_000, 47], [1_700_086_400_000, 45]] });
    if (url.includes("stablecoins.llama.fi")) {
      return response([
        { date: "1700000000", totalCirculatingUSD: { peggedUSD: 150_000_000_000 } },
        { date: "1700086400", totalCirculatingUSD: { peggedUSD: 151_000_000_000 } }
      ]);
    }
    const seriesId = new URL(url).searchParams.get("id") ?? "SERIES";
    const values: Record<string, [number, number]> = {
      DGS10: [4.2, 4.3],
      WALCL: [6_500_000, 6_600_000],
      WTREGEN: [800_000, 810_000],
      RRPONTSYD: [10, 9],
      M2SL: [22_000, 22_100],
      SP500: [7_500, 7_550],
      NASDAQCOM: [25_000, 25_250],
      MORTGAGE30US: [6.5, 6.55],
      CSUSHPINSA: [320, 324]
    };
    const [first, second] = values[seriesId] ?? [1, 2];
    return response(`observation_date,${seriesId}\n2026-01-01,${first}\n2026-01-02,\n2026-01-08,${second}\n`, "text/csv");
  };
  return { fetcher, getCalls: () => calls };
}

describe("PublicMarketProvider", () => {
  it("normalizes sourced crypto and FRED data and caches the dashboard", async () => {
    const source = successfulFetcher();
    const provider = new PublicMarketProvider(null, 300_000, source.fetcher);
    const first = await provider.getDashboard();
    const second = await provider.getDashboard();

    expect(first.status).toBe("ready");
    expect(first.metrics).toHaveLength(18);
    expect(first.metrics.find((metric) => metric.id === "total2")?.value).toBe(1_000_000);
    expect(first.metrics.find((metric) => metric.id === "treasury10y")?.change).toBeCloseTo(10);
    expect(first.metrics.find((metric) => metric.id === "bitcoin")?.points).toHaveLength(2);
    expect(second).toBe(first);
    expect(first.metrics.find((metric) => metric.id === "solana")?.value).toBe(180);
    expect(first.metrics.find((metric) => metric.id === "hyperliquid")?.points).toHaveLength(2);
    expect(first.metrics.find((metric) => metric.id === "stablecoinSupply")?.value).toBe(151_000_000_000);
    expect(first.metrics.find((metric) => metric.id === "fedNetLiquidity")?.value).toBe(5_781_000);
    expect(first.metrics.find((metric) => metric.id === "sp500")?.value).toBe(7_550);
    expect(source.getCalls()).toBe(17);
  });

  it("keeps working metrics available when the crypto feed fails", async () => {
    const source = successfulFetcher();
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes("api.coingecko.com")) throw new Error("provider offline");
      return source.fetcher(input, init);
    };
    const dashboard = await new PublicMarketProvider(null, 300_000, fetcher).getDashboard();

    expect(dashboard.status).toBe("partial");
    expect(dashboard.metrics.find((metric) => metric.id === "bitcoin")?.status).toBe("unavailable");
    expect(dashboard.metrics.find((metric) => metric.id === "treasury10y")?.status).toBe("ready");
  });

  it("retries a transient asset-history failure without dropping its live price", async () => {
    const source = successfulFetcher();
    let solanaAttempts = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes("/coins/solana/") && ++solanaAttempts === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return source.fetcher(input, init);
    };

    const dashboard = await new PublicMarketProvider(null, 300_000, fetcher).getDashboard();
    expect(solanaAttempts).toBe(2);
    expect(dashboard.metrics.find((metric) => metric.id === "solana")).toMatchObject({
      status: "ready",
      historyStatus: "ready",
      value: 180
    });
  });
});
