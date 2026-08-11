import type {
  MarketDashboard,
  MarketMetric,
  MarketMetricId,
  MarketPoint
} from "../../shared/contracts.js";

type Fetcher = typeof fetch;

interface CoinGeckoSimpleAsset {
  usd?: number;
  usd_market_cap?: number;
  usd_24h_change?: number;
  last_updated_at?: number;
}

interface CoinGeckoGlobal {
  data?: {
    total_market_cap?: { usd?: number };
    market_cap_change_percentage_24h_usd?: number;
    updated_at?: number;
  };
}

interface CoinGeckoChart {
  prices?: Array<[number, number]>;
}

interface FredDefinition {
  id: MarketMetricId;
  label: string;
  seriesId: string;
  unit: MarketMetric["unit"];
  frequency: string;
  changeType: NonNullable<MarketMetric["changeType"]>;
  historyDays: number;
}

interface CryptoDefinition {
  id: "bitcoin" | "ethereum" | "solana" | "sui" | "hyperliquid";
  coinGeckoId: string;
  label: string;
}

const coinGeckoSource = "CoinGecko";
const coinGeckoSourceUrl = "https://www.coingecko.com/";

const cryptoAssets: CryptoDefinition[] = [
  { id: "bitcoin", coinGeckoId: "bitcoin", label: "Bitcoin" },
  { id: "ethereum", coinGeckoId: "ethereum", label: "Ethereum" },
  { id: "solana", coinGeckoId: "solana", label: "Solana" },
  { id: "sui", coinGeckoId: "sui", label: "Sui" },
  { id: "hyperliquid", coinGeckoId: "hyperliquid", label: "Hyperliquid" }
];

const fredSeries: FredDefinition[] = [
  {
    id: "treasury10y",
    label: "10-Year Treasury",
    seriesId: "DGS10",
    unit: "percent",
    frequency: "Daily",
    changeType: "basis_points",
    historyDays: 180
  },
  {
    id: "fedLiquidity",
    label: "Federal Reserve Assets",
    seriesId: "WALCL",
    unit: "usd_millions",
    frequency: "Weekly",
    changeType: "percent",
    historyDays: 730
  },
  {
    id: "mortgage30y",
    label: "30-Year Mortgage Rate",
    seriesId: "MORTGAGE30US",
    unit: "percent",
    frequency: "Weekly",
    changeType: "basis_points",
    historyDays: 730
  },
  {
    id: "homePrices",
    label: "U.S. Home Price Index",
    seriesId: "CSUSHPINSA",
    unit: "index",
    frequency: "Monthly",
    changeType: "percent",
    historyDays: 1825
  }
];

function unavailableMetric(
  id: MarketMetricId,
  label: string,
  source: string,
  sourceUrl: string,
  frequency = "Unavailable"
): MarketMetric {
  return {
    id,
    label,
    status: "unavailable",
    message: "This feed is temporarily unavailable.",
    value: null,
    unit: "index",
    change: null,
    changeType: null,
    asOf: null,
    frequency,
    source,
    sourceUrl,
    historyStatus: "unavailable",
    historyMessage: "Historical observations could not be loaded.",
    points: []
  };
}

function change(previous: number, current: number, type: FredDefinition["changeType"]): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
    return null;
  }
  return type === "basis_points" ? (current - previous) * 100 : ((current - previous) / previous) * 100;
}

function downsample(points: MarketPoint[], maximum = 180): MarketPoint[] {
  if (points.length <= maximum) {
    return points;
  }
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]!);
}

function dateDaysAgo(days: number): string {
  const value = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

async function fetchWithTimeout(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Market provider returned ${response.status}.`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function unixTimestamp(seconds: number | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chartPoints(chart: CoinGeckoChart | null): MarketPoint[] {
  return downsample(
    (chart?.prices ?? [])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map(([timestamp, value]) => ({ timestamp: new Date(timestamp).toISOString(), value }))
  );
}

export class PublicMarketProvider {
  private cached: MarketDashboard | null = null;
  private cacheExpiresAt = 0;
  private inflight: Promise<MarketDashboard> | null = null;

  constructor(
    private readonly coinGeckoApiKey: string | null,
    private readonly cacheMs: number,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async getDashboard(): Promise<MarketDashboard> {
    if (this.cached && Date.now() < this.cacheExpiresAt) {
      return this.cached;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.loadDashboard();
    try {
      const dashboard = await this.inflight;
      this.cached = dashboard;
      this.cacheExpiresAt = Date.now() + this.cacheMs;
      return dashboard;
    } finally {
      this.inflight = null;
    }
  }

  private async loadDashboard(): Promise<MarketDashboard> {
    const [cryptoResults, fredResults] = await Promise.all([
      Promise.allSettled([this.loadCrypto()]),
      Promise.allSettled(fredSeries.map((definition) => this.loadFred(definition)))
    ]);
    const metrics: MarketMetric[] = [];

    const cryptoResult = cryptoResults[0];
    if (cryptoResult?.status === "fulfilled") {
      metrics.push(...cryptoResult.value);
    } else {
      metrics.push(
        unavailableMetric("total", "Total Crypto Market Cap", coinGeckoSource, coinGeckoSourceUrl),
        unavailableMetric("total2", "Crypto Market Cap ex-Bitcoin", coinGeckoSource, coinGeckoSourceUrl),
        unavailableMetric("bitcoin", "Bitcoin", coinGeckoSource, coinGeckoSourceUrl),
        unavailableMetric("ethereum", "Ethereum", coinGeckoSource, coinGeckoSourceUrl),
        unavailableMetric("solana", "Solana", coinGeckoSource, coinGeckoSourceUrl),
        unavailableMetric("sui", "Sui", coinGeckoSource, coinGeckoSourceUrl),
        unavailableMetric("hyperliquid", "Hyperliquid", coinGeckoSource, coinGeckoSourceUrl)
      );
    }

    fredSeries.forEach((definition, index) => {
      const result = fredResults[index];
      metrics.push(
        result?.status === "fulfilled"
          ? result.value
          : unavailableMetric(
              definition.id,
              definition.label,
              "Federal Reserve Economic Data",
              `https://fred.stlouisfed.org/series/${definition.seriesId}`,
              definition.frequency
            )
      );
    });

    const readyCount = metrics.filter((metric) => metric.status === "ready").length;
    const expectedHistoryReady = metrics
      .filter((metric) => cryptoAssets.some((asset) => asset.id === metric.id))
      .every((metric) => metric.historyStatus === "ready");
    return {
      status: readyCount === metrics.length && expectedHistoryReady ? "ready" : readyCount > 0 ? "partial" : "unavailable",
      updatedAt: new Date().toISOString(),
      metrics
    };
  }

  private async coinGeckoJson<T>(path: string): Promise<T> {
    const headers: HeadersInit = { Accept: "application/json" };
    if (this.coinGeckoApiKey) {
      headers["x-cg-demo-api-key"] = this.coinGeckoApiKey;
    }
    const response = await fetchWithTimeout(this.fetcher, `https://api.coingecko.com/api/v3${path}`, { headers });
    return (await response.json()) as T;
  }

  private async coinGeckoChart(coinGeckoId: string): Promise<CoinGeckoChart | null> {
    const retryDelays = [0, 500, 1_500];
    for (const delay of retryDelays) {
      if (delay) await wait(delay);
      try {
        return await this.coinGeckoJson<CoinGeckoChart>(
          `/coins/${coinGeckoId}/market_chart?vs_currency=usd&days=90&interval=daily`
        );
      } catch {
        // Current prices can remain available even when a chart request is rate-limited.
      }
    }
    return null;
  }

  private async loadCrypto(): Promise<MarketMetric[]> {
    const ids = cryptoAssets.map((asset) => asset.coinGeckoId).join("%2C");
    const [simple, global, charts] = await Promise.all([
      this.coinGeckoJson<Record<string, CoinGeckoSimpleAsset>>(
        `/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true&include_last_updated_at=true`
      ),
      this.coinGeckoJson<CoinGeckoGlobal>("/global"),
      Promise.all(
        cryptoAssets.map((asset) => this.coinGeckoChart(asset.coinGeckoId))
      )
    ]);

    const bitcoin = simple.bitcoin;
    const total = global.data?.total_market_cap?.usd;
    const bitcoinMarketCap = bitcoin?.usd_market_cap;

    const totalChange = global.data?.market_cap_change_percentage_24h_usd ?? null;
    const total2 = total !== undefined && bitcoinMarketCap !== undefined ? total - bitcoinMarketCap : null;
    let total2Change: number | null = null;
    if (total2 !== null && total !== undefined && bitcoinMarketCap !== undefined && totalChange !== null && bitcoin?.usd_24h_change !== undefined) {
      const previousTotal = total / (1 + totalChange / 100);
      const previousBitcoin = bitcoinMarketCap / (1 + bitcoin.usd_24h_change / 100);
      if (previousTotal > previousBitcoin) {
        total2Change = ((total2 - (previousTotal - previousBitcoin)) / (previousTotal - previousBitcoin)) * 100;
      }
    }

    const globalAsOf = unixTimestamp(global.data?.updated_at);
    const currentAggregateHistory = "Current aggregate only. Historical global market-cap data requires a licensed feed.";
    const createCurrentMetric = (
      id: MarketMetricId,
      label: string,
      value: number | null | undefined,
      metricChange: number | null,
      asOf: string | null
    ): MarketMetric => value === null || value === undefined
      ? unavailableMetric(id, label, coinGeckoSource, coinGeckoSourceUrl)
      : ({
          id,
          label,
          status: "ready",
          message: null,
          value,
          unit: "usd_compact",
          change: metricChange,
          changeType: "percent",
          asOf,
          frequency: "Live snapshot",
          source: coinGeckoSource,
          sourceUrl: coinGeckoSourceUrl,
          historyStatus: "unavailable",
          historyMessage: currentAggregateHistory,
          points: []
        });

    const createAssetMetric = (
      id: CryptoDefinition["id"],
      label: string,
      asset: CoinGeckoSimpleAsset | undefined,
      chart: CoinGeckoChart | null
    ): MarketMetric => {
      if (asset?.usd === undefined) return unavailableMetric(id, label, coinGeckoSource, coinGeckoSourceUrl);
      const points = chartPoints(chart);
      return {
        id,
        label,
        status: "ready",
        message: null,
        value: asset.usd ?? null,
        unit: "usd",
        change: asset.usd_24h_change ?? null,
        changeType: "percent",
        asOf: unixTimestamp(asset.last_updated_at),
        frequency: "Live snapshot / 90-day chart",
        source: coinGeckoSource,
        sourceUrl: coinGeckoSourceUrl,
        historyStatus: points.length > 1 ? "ready" : "unavailable",
        historyMessage: points.length > 1 ? null : "Ninety-day price history is temporarily unavailable.",
        points
      };
    };

    const assetMetrics = cryptoAssets.map((definition, index) =>
      createAssetMetric(definition.id, definition.label, simple[definition.coinGeckoId], charts[index] ?? null)
    );

    return [
      createCurrentMetric("total", "Total Crypto Market Cap", total, totalChange, globalAsOf),
      createCurrentMetric("total2", "Crypto Market Cap ex-Bitcoin", total2, total2Change, globalAsOf),
      ...assetMetrics
    ];
  }

  private async loadFred(definition: FredDefinition): Promise<MarketMetric> {
    const startDate = dateDaysAgo(definition.historyDays);
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${definition.seriesId}&cosd=${startDate}`;
    const response = await fetchWithTimeout(this.fetcher, url, { headers: { Accept: "text/csv" } });
    const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
    const points = rows
      .map((row) => {
        const [date, rawValue] = row.split(",");
        const normalizedValue = rawValue?.trim();
        if (!date || !normalizedValue || normalizedValue === ".") return null;
        const value = Number(normalizedValue);
        return Number.isFinite(value) ? { timestamp: `${date}T00:00:00.000Z`, value } : null;
      })
      .filter((point): point is MarketPoint => point !== null);
    if (points.length === 0) {
      throw new Error(`FRED series ${definition.seriesId} returned no observations.`);
    }
    const current = points.at(-1)!;
    const previous = points.at(-2);
    return {
      id: definition.id,
      label: definition.label,
      status: "ready",
      message: null,
      value: current.value,
      unit: definition.unit,
      change: previous ? change(previous.value, current.value, definition.changeType) : null,
      changeType: definition.changeType,
      asOf: current.timestamp,
      frequency: definition.frequency,
      source: "Federal Reserve Economic Data",
      sourceUrl: `https://fred.stlouisfed.org/series/${definition.seriesId}`,
      historyStatus: points.length > 1 ? "ready" : "unavailable",
      historyMessage: points.length > 1 ? null : "This series does not yet have enough observations for a chart.",
      points: downsample(points)
    };
  }
}
