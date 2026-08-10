import { formatUnits, getAddress, type Address } from "viem";
import type { PortfolioHolding, PortfolioOverview, SupportedChain } from "../../shared/contracts.js";

export interface PortfolioProvider {
  readonly name: string;
  getPortfolio(address: Address, chain: SupportedChain): Promise<PortfolioOverview>;
}

export class PortfolioProviderError extends Error {
  constructor(message = "Portfolio data is temporarily unavailable.") {
    super(message);
  }
}

interface GoldRushItem {
  contract_address?: string | null;
  contract_name?: string | null;
  contract_ticker_symbol?: string | null;
  contract_decimals?: number | null;
  balance?: string | null;
  quote?: number | null;
  quote_rate?: number | null;
  quote_24h?: number | null;
  is_spam?: boolean | null;
  logo_url?: string | null;
  logo_urls?: string[] | Record<string, string | null> | null;
}

interface GoldRushResponse {
  data?: {
    address?: string;
    updated_at?: string;
    items?: GoldRushItem[];
  } | null;
  error?: boolean;
  error_code?: number | string;
  error_message?: string;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function logoFrom(item: GoldRushItem): string | null {
  if (typeof item.logo_url === "string") {
    return item.logo_url;
  }

  if (Array.isArray(item.logo_urls)) {
    return item.logo_urls.find((url) => typeof url === "string") ?? null;
  }

  if (item.logo_urls && typeof item.logo_urls === "object") {
    return Object.values(item.logo_urls).find((url): url is string => typeof url === "string") ?? null;
  }

  return null;
}

function readableBalance(balance: string | null | undefined, decimals: number | null | undefined): string | null {
  if (!balance || !/^\d+$/.test(balance)) {
    return null;
  }

  try {
    return formatUnits(BigInt(balance), Math.max(0, decimals ?? 0));
  } catch {
    return null;
  }
}

function isPositiveBalance(value: string): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric > 0 : !/^0(?:\.0+)?$/.test(value);
}

export class GoldRushPortfolioProvider implements PortfolioProvider {
  readonly name = "GoldRush";

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getPortfolio(address: Address, chain: SupportedChain): Promise<PortfolioOverview> {
    const endpoint = new URL(
      `https://api.covalenthq.com/v1/${encodeURIComponent(chain.providerSlug)}/address/${getAddress(address)}/balances_v2/`
    );
    endpoint.searchParams.set("no-spam", "true");
    endpoint.searchParams.set("quote-currency", "USD");

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(12_000)
      });
    } catch {
      throw new PortfolioProviderError();
    }

    if (!response.ok) {
      throw new PortfolioProviderError();
    }

    const payload = (await response.json()) as GoldRushResponse;
    if (payload.error || !payload.data || !Array.isArray(payload.data.items)) {
      throw new PortfolioProviderError();
    }

    const holdings: PortfolioHolding[] = [];
    for (const item of payload.data.items) {
      if (item.is_spam) continue;
      const balance = readableBalance(item.balance, item.contract_decimals);
      if (!balance || !isPositiveBalance(balance)) continue;

      const valueUsd = finiteNumber(item.quote);
      const previousValue = finiteNumber(item.quote_24h);
      const change24hPct =
        valueUsd !== null && previousValue !== null && previousValue > 0
          ? ((valueUsd - previousValue) / previousValue) * 100
          : null;

      holdings.push({
        symbol: (item.contract_ticker_symbol || "TOKEN").toUpperCase(),
        name: item.contract_name || item.contract_ticker_symbol || "Token",
        contractAddress: item.contract_address || "native",
        balance,
        priceUsd: finiteNumber(item.quote_rate),
        valueUsd,
        allocationPct: null,
        change24hPct,
        logoUrl: logoFrom(item)
      });
    }
    holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

    const totalValueUsd = holdings.reduce((total, holding) => total + (holding.valueUsd ?? 0), 0);
    for (const holding of holdings) {
      holding.allocationPct = holding.valueUsd !== null && totalValueUsd > 0 ? (holding.valueUsd / totalValueUsd) * 100 : null;
    }

    const valuedHoldings = holdings.filter((holding) => holding.valueUsd !== null);
    const complete24h = valuedHoldings.length > 0 && valuedHoldings.every((holding) => holding.change24hPct !== null);
    const previousTotal = complete24h
      ? valuedHoldings.reduce((total, holding) => {
          const current = holding.valueUsd ?? 0;
          return total + current / (1 + (holding.change24hPct ?? 0) / 100);
        }, 0)
      : null;
    const change24hUsd = previousTotal !== null ? totalValueUsd - previousTotal : null;
    const change24hPct = previousTotal !== null && previousTotal > 0 ? (change24hUsd! / previousTotal) * 100 : null;

    return {
      status: holdings.length > 0 ? "ready" : "empty",
      message: holdings.length > 0 ? null : "No supported assets were found on this network.",
      provider: this.name,
      address: getAddress(address),
      chainId: chain.id,
      network: chain.name,
      asOf: payload.data.updated_at ?? new Date().toISOString(),
      totalValueUsd,
      assetCount: holdings.length,
      change24hPct,
      change24hUsd,
      holdings
    };
  }
}

export class UnavailablePortfolioProvider implements PortfolioProvider {
  readonly name = "Not configured";

  async getPortfolio(address: Address, chain: SupportedChain): Promise<PortfolioOverview> {
    return {
      status: "unavailable",
      message: "Read-only portfolio data is not configured yet. Add a server-side GoldRush API key to enable holdings.",
      provider: null,
      address: getAddress(address),
      chainId: chain.id,
      network: chain.name,
      asOf: null,
      totalValueUsd: null,
      assetCount: 0,
      change24hPct: null,
      change24hUsd: null,
      holdings: []
    };
  }
}

export class CachedPortfolioProvider implements PortfolioProvider {
  readonly name: string;
  private readonly cache = new Map<string, { expiresAt: number; value: PortfolioOverview }>();

  constructor(
    private readonly provider: PortfolioProvider,
    private readonly cacheMs: number
  ) {
    this.name = provider.name;
  }

  async getPortfolio(address: Address, chain: SupportedChain): Promise<PortfolioOverview> {
    const key = `${address.toLowerCase()}:${chain.id}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.provider.getPortfolio(address, chain);
    this.cache.set(key, { expiresAt: Date.now() + this.cacheMs, value });
    return value;
  }
}
