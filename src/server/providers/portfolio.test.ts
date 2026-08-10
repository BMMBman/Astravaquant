import { describe, expect, it, vi } from "vitest";
import { GoldRushPortfolioProvider } from "./portfolio.js";

describe("GoldRushPortfolioProvider", () => {
  it("normalizes indexed balances, filters spam, and calculates allocation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            updated_at: "2026-08-10T00:00:00.000Z",
            items: [
              {
                contract_address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                contract_name: "Ether",
                contract_ticker_symbol: "ETH",
                contract_decimals: 18,
                balance: "2000000000000000000",
                quote: 5000,
                quote_rate: 2500,
                quote_24h: 4800,
                is_spam: false,
                logo_urls: { token_logo_url: "https://example.com/eth.png" }
              },
              {
                contract_name: "Spam",
                contract_ticker_symbol: "SPAM",
                contract_decimals: 0,
                balance: "1",
                quote: 1000000,
                is_spam: true
              }
            ]
          },
          error: false
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const provider = new GoldRushPortfolioProvider("server-only-key", fetcher);
    const result = await provider.getPortfolio(
      "0x0000000000000000000000000000000000000001",
      { id: 1, name: "Ethereum", shortName: "ETH", providerSlug: "eth-mainnet" }
    );

    expect(result.status).toBe("ready");
    expect(result.totalValueUsd).toBe(5000);
    expect(result.assetCount).toBe(1);
    expect(result.holdings[0]).toMatchObject({ symbol: "ETH", balance: "2", allocationPct: 100 });
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer server-only-key" }) })
    );
  });
});
