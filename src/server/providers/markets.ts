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

interface CoinPaprikaGlobal {
  market_cap_usd?: number;
  market_cap_change_24h?: number;
  last_updated?: number;
}

interface CoinPaprikaTicker {
  id?: string;
  last_updated?: string;
  quotes?: {
    USD?: {
      price?: number;
      market_cap?: number;
      percent_change_24h?: number;
    };
  };
}

interface DefiLlamaStablecoinPoint {
  date?: string;
  totalCirculatingUSD?: { peggedUSD?: number };
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
  coinPaprikaId: string;
  label: string;
}

const coinGeckoSource = "CoinGecko";
const coinGeckoSourceUrl = "https://www.coingecko.com/";
const coinPaprikaSource = "CoinPaprika";
const coinPaprikaSourceUrl = "https://coinpaprika.com/";

const cryptoAssets: CryptoDefinition[] = [
  { id: "bitcoin", coinGeckoId: "bitcoin", coinPaprikaId: "btc-bitcoin", label: "Bitcoin" },
  { id: "ethereum", coinGeckoId: "ethereum", coinPaprikaId: "eth-ethereum", label: "Ethereum" },
  { id: "solana", coinGeckoId: "solana", coinPaprikaId: "sol-solana", label: "Solana" },
  { id: "sui", coinGeckoId: "sui", coinPaprikaId: "sui-sui", label: "Sui" },
  { id: "hyperliquid", coinGeckoId: "hyperliquid", coinPaprikaId: "hype-hyperliquid", label: "Hyperliquid" }
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
    id: "treasuryGeneralAccount",
    label: "Treasury General Account",
    seriesId: "WTREGEN",
    unit: "usd_millions",
    frequency: "Weekly",
    changeType: "percent",
    historyDays: 1825
  },
  {
    id: "reverseRepo",
    label: "Overnight Reverse Repo",
    seriesId: "RRPONTSYD",
    unit: "usd_billions",
    frequency: "Daily",
    changeType: "percent",
    historyDays: 1825
  },
  {
    id: "m2MoneySupply",
    label: "U.S. M2 Money Supply",
    seriesId: "M2SL",
    unit: "usd_billions",
    frequency: "Monthly",
    changeType: "percent",
    historyDays: 3650
  },
  {
    id: "sp500",
    label: "S&P 500",
    seriesId: "SP500",
    unit: "index",
    frequency: "Daily close",
    changeType: "percent",
    historyDays: 730
  },
  {
    id: "nasdaq",
    label: "Nasdaq Composite",
    seriesId: "NASDAQCOM",
    unit: "index",
    frequency: "Daily close",
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

function downsample(points: MarketPoint[], maximum = 720): MarketPoint[] {
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

function latestAtOrBefore(points: MarketPoint[], timestamp: string): number | null {
  let latest: number | null = null;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    latest = point.value;
  }
  return latest;
}

export function deriveFedNetLiquidity(metrics: MarketMetric[]): MarketMetric {
  const fed = metrics.find((metric) => metric.id === "fedLiquidity" && metric.status === "ready");
  const tga = metrics.find((metric) => metric.id === "treasuryGeneralAccount" && metric.status === "ready");
  const rrp = metrics.find((metric) => metric.id === "reverseRepo" && metric.status === "ready");
  const sourceUrl = "https://fred.stlouisfed.org/series/WALCL";
  if (!fed || !tga || !rrp) {
    return unavailableMetric("fedNetLiquidity", "Fed Net Liquidity", "Derived from Federal Reserve Economic Data", sourceUrl, "Weekly derived");
  }

  const points = fed.points.flatMap((point) => {
    const tgaValue = latestAtOrBefore(tga.points, point.timestamp);
    const rrpBillions = latestAtOrBefore(rrp.points, point.timestamp);
    return tgaValue === null || rrpBillions === null
      ? []
      : [{ timestamp: point.timestamp, value: point.value - tgaValue - rrpBillions * 1_000 }];
  });
  if (!points.length) {
    return unavailableMetric("fedNetLiquidity", "Fed Net Liquidity", "Derived from Federal Reserve Economic Data", sourceUrl, "Weekly derived");
  }
  const current = points.at(-1)!;
  const previous = points.at(-2);
  return {
    id: "fedNetLiquidity",
    label: "Fed Net Liquidity",
    status: "ready",
    message: "Derived as Federal Reserve assets minus the Treasury General Account minus overnight reverse repo.",
    value: current.value,
    unit: "usd_millions",
    change: previous ? change(previous.value, current.value, "percent") : null,
    changeType: "percent",
    asOf: current.timestamp,
    frequency: "Weekly derived",
    source: "FRED-derived",
    sourceUrl,
    historyStatus: points.length > 1 ? "ready" : "unavailable",
    historyMessage: points.length > 1 ? null : "One aligned liquidity observation is available.",
    points: downsample(points)
  };
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
    const [cryptoResults, fredResults, stablecoinResults] = await Promise.all([
      Promise.allSettled([this.loadCrypto()]),
      Promise.allSettled(fredSeries.map((definition) => this.loadFred(definition))),
      Promise.allSettled([this.loadStablecoinSupply()])
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

    const stablecoinResult = stablecoinResults[0];
    metrics.push(stablecoinResult?.status === "fulfilled"
      ? stablecoinResult.value
      : unavailableMetric("stablecoinSupply", "Stablecoin Supply", "DefiLlama", "https://defillama.com/stablecoins", "Daily"));
    metrics.push(deriveFedNetLiquidity(metrics));

    const readyCount = metrics.filter((metric) => metric.status === "ready").length;
    return {
      status: readyCount === metrics.length ? "ready" : readyCount > 0 ? "partial" : "unavailable",
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

  private async coinPaprikaJson<T>(path: string): Promise<T> {
    const response = await fetchWithTimeout(this.fetcher, `https://api.coinpaprika.com/v1${path}`, {
      headers: { Accept: "application/json" }
    });
    return (await response.json()) as T;
  }

  private async loadCoinPaprikaSnapshot(): Promise<{
    global: CoinPaprikaGlobal | null;
    tickers: Map<string, CoinPaprikaTicker>;
  }> {
    const [globalResult, ...tickerResults] = await Promise.allSettled([
      this.coinPaprikaJson<CoinPaprikaGlobal>("/global"),
      ...cryptoAssets.map((asset) => this.coinPaprikaJson<CoinPaprikaTicker>(`/tickers/${asset.coinPaprikaId}`))
    ]);
    const tickers = new Map<string, CoinPaprikaTicker>();
    tickerResults.forEach((result, index) => {
      if (result.status === "fulfilled") tickers.set(cryptoAssets[index]!.id, result.value);
    });
    return {
      global: globalResult?.status === "fulfilled" ? globalResult.value : null,
      tickers
    };
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
    const [snapshotResults, charts] = await Promise.all([
      Promise.allSettled([
        this.coinGeckoJson<Record<string, CoinGeckoSimpleAsset>>(
          `/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true&include_last_updated_at=true`
        ),
        this.coinGeckoJson<CoinGeckoGlobal>("/global")
      ]),
      Promise.all(
        cryptoAssets.map((asset) => this.coinGeckoChart(asset.coinGeckoId))
      )
    ]);
    const simple = snapshotResults[0]?.status === "fulfilled" ? snapshotResults[0].value : {};
    const global = snapshotResults[1]?.status === "fulfilled" ? snapshotResults[1].value : {};
    const needsFallback = global.data?.total_market_cap?.usd === undefined
      || simple.bitcoin?.usd_market_cap === undefined
      || cryptoAssets.some((asset) => simple[asset.coinGeckoId]?.usd === undefined);
    const fallback = needsFallback ? await this.loadCoinPaprikaSnapshot() : null;
    const resolvedAssets = new Map(cryptoAssets.map((definition) => {
      const primary = simple[definition.coinGeckoId];
      const fallbackTicker = fallback?.tickers.get(definition.id);
      const fallbackQuote = fallbackTicker?.quotes?.USD;
      const fallbackTimestamp = fallbackTicker?.last_updated ? Date.parse(fallbackTicker.last_updated) / 1_000 : undefined;
      const asset: CoinGeckoSimpleAsset = {
        usd: primary?.usd ?? fallbackQuote?.price,
        usd_market_cap: primary?.usd_market_cap ?? fallbackQuote?.market_cap,
        usd_24h_change: primary?.usd_24h_change ?? fallbackQuote?.percent_change_24h,
        last_updated_at: primary?.last_updated_at ?? (Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : undefined)
      };
      return [definition.id, {
        asset,
        fallback: primary?.usd === undefined && fallbackQuote?.price !== undefined
      }] as const;
    }));

    const bitcoin = resolvedAssets.get("bitcoin")?.asset;
    const primaryTotal = global.data?.total_market_cap?.usd;
    const total = primaryTotal ?? fallback?.global?.market_cap_usd;
    const bitcoinMarketCap = bitcoin?.usd_market_cap;

    const totalChange = global.data?.market_cap_change_percentage_24h_usd ?? fallback?.global?.market_cap_change_24h ?? null;
    const total2 = total !== undefined && bitcoinMarketCap !== undefined ? total - bitcoinMarketCap : null;
    let total2Change: number | null = null;
    if (total2 !== null && total !== undefined && bitcoinMarketCap !== undefined && totalChange !== null && bitcoin?.usd_24h_change !== undefined) {
      const previousTotal = total / (1 + totalChange / 100);
      const previousBitcoin = bitcoinMarketCap / (1 + bitcoin.usd_24h_change / 100);
      if (previousTotal > previousBitcoin) {
        total2Change = ((total2 - (previousTotal - previousBitcoin)) / (previousTotal - previousBitcoin)) * 100;
      }
    }

    const globalAsOf = unixTimestamp(global.data?.updated_at ?? fallback?.global?.last_updated);
    const aggregateSource = primaryTotal === undefined && total !== undefined ? coinPaprikaSource : coinGeckoSource;
    const aggregateSourceUrl = aggregateSource === coinPaprikaSource ? coinPaprikaSourceUrl : coinGeckoSourceUrl;
    const currentAggregateHistory = "Current aggregate only. Historical global market-cap data requires a licensed feed.";
    const createCurrentMetric = (
      id: MarketMetricId,
      label: string,
      value: number | null | undefined,
      metricChange: number | null,
      asOf: string | null,
      source: string,
      sourceUrl: string
    ): MarketMetric => value === null || value === undefined
      ? unavailableMetric(id, label, source, sourceUrl)
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
          source,
          sourceUrl,
          historyStatus: "unavailable",
          historyMessage: currentAggregateHistory,
          points: []
        });

    const createAssetMetric = (
      id: CryptoDefinition["id"],
      label: string,
      asset: CoinGeckoSimpleAsset | undefined,
      chart: CoinGeckoChart | null,
      usesFallback: boolean
    ): MarketMetric => {
      const source = usesFallback ? coinPaprikaSource : coinGeckoSource;
      const sourceUrl = usesFallback ? coinPaprikaSourceUrl : coinGeckoSourceUrl;
      if (asset?.usd === undefined) return unavailableMetric(id, label, source, sourceUrl);
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
        source: usesFallback && points.length ? `${coinPaprikaSource} / ${coinGeckoSource}` : source,
        sourceUrl,
        historyStatus: points.length > 1 ? "ready" : "unavailable",
        historyMessage: points.length > 1 ? null : "Ninety-day price history is temporarily unavailable.",
        points
      };
    };

    const assetMetrics = cryptoAssets.map((definition, index) => {
      const resolved = resolvedAssets.get(definition.id)!;
      return createAssetMetric(definition.id, definition.label, resolved.asset, charts[index] ?? null, resolved.fallback);
    });

    return [
      createCurrentMetric("total", "Total Crypto Market Cap", total, totalChange, globalAsOf, aggregateSource, aggregateSourceUrl),
      createCurrentMetric("total2", "Crypto Market Cap ex-Bitcoin", total2, total2Change, globalAsOf, aggregateSource, aggregateSourceUrl),
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

  private async loadStablecoinSupply(): Promise<MarketMetric> {
    const response = await fetchWithTimeout(this.fetcher, "https://stablecoins.llama.fi/stablecoincharts/all", {
      headers: { Accept: "application/json" }
    });
    const rows = (await response.json()) as DefiLlamaStablecoinPoint[];
    const rawPoints = rows.flatMap((row) => {
      const seconds = Number(row.date);
      const value = row.totalCirculatingUSD?.peggedUSD;
      return Number.isFinite(seconds) && Number.isFinite(value)
        ? [{ timestamp: new Date(seconds * 1_000).toISOString(), value: value! }]
        : [];
    }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    if (!rawPoints.length) throw new Error("DefiLlama returned no stablecoin observations.");
    const current = rawPoints.at(-1)!;
    const previous = rawPoints.at(-2);
    const points = downsample(rawPoints);
    return {
      id: "stablecoinSupply",
      label: "Stablecoin Supply",
      status: "ready",
      message: null,
      value: current.value,
      unit: "usd_compact",
      change: previous ? change(previous.value, current.value, "percent") : null,
      changeType: "percent",
      asOf: current.timestamp,
      frequency: "Daily",
      source: "DefiLlama",
      sourceUrl: "https://defillama.com/stablecoins",
      historyStatus: points.length > 1 ? "ready" : "unavailable",
      historyMessage: points.length > 1 ? null : "Stablecoin history does not yet contain enough observations.",
      points
    };
  }
}
