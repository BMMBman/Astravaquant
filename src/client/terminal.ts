import type {
  MarketDashboard,
  MarketMetric,
  MarketMetricId,
  MarketPoint
} from "../shared/contracts.js";
import { apiRequest } from "./api.js";
import { trackProductEvent } from "./analytics.js";

type HistoryPeriod = "30D" | "90D" | "1Y" | "YTD" | "ALL";

const marketPeriods: HistoryPeriod[] = ["30D", "90D", "1Y", "ALL"];
const cryptoIds: MarketMetricId[] = ["bitcoin", "ethereum", "solana", "sui", "hyperliquid"];
const quoteIds: MarketMetricId[] = ["total", "total2", ...cryptoIds];
const liquidityIds: MarketMetricId[] = ["fedNetLiquidity", "fedLiquidity", "treasuryGeneralAccount", "reverseRepo", "m2MoneySupply", "stablecoinSupply"];
const crossAssetIds: MarketMetricId[] = ["sp500", "nasdaq", "treasury10y"];
const housingIds: MarketMetricId[] = ["mortgage30y", "homePrices"];
const symbols: Partial<Record<MarketMetricId, string>> = {
  total: "TOTAL",
  total2: "TOTAL2",
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  sui: "SUI",
  hyperliquid: "HYPE",
  treasury10y: "US10Y",
  fedLiquidity: "WALCL",
  fedNetLiquidity: "NET LIQ",
  treasuryGeneralAccount: "TGA",
  reverseRepo: "ON RRP",
  m2MoneySupply: "M2",
  stablecoinSupply: "STABLES",
  sp500: "SPX",
  nasdaq: "NASDAQ",
  mortgage30y: "MORTGAGE30US",
  homePrices: "CSUSHPINSA"
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function formatValue(metric: MarketMetric, value = metric.value): string {
  if (value === null) return "Unavailable";
  if (metric.unit === "percent") return `${value.toFixed(2)}%`;
  if (metric.unit === "index") return value.toFixed(1);
  if (metric.unit === "usd_millions") return `$${(value / 1_000_000).toFixed(2)}T`;
  if (metric.unit === "usd_billions") {
    return value >= 1_000
      ? `$${(value / 1_000).toFixed(2)}T`
      : `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
  }
  if (metric.unit === "usd_compact") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1_000 ? 0 : value >= 1 ? 2 : 4
  }).format(value);
}

function formatChange(metric: MarketMetric): string {
  if (metric.change === null) return "Change unavailable";
  const prefix = metric.change > 0 ? "+" : "";
  if (metric.changeType === "basis_points") return `${prefix}${metric.change.toFixed(0)} bps latest`;
  const isCrypto = quoteIds.includes(metric.id);
  return `${prefix}${metric.change.toFixed(2)}% ${isCrypto ? "24h" : "latest"}`;
}

function tone(value: number | null): string {
  return value === null ? "neutral" : value >= 0 ? "positive" : "negative";
}

function formatAsOf(value: string | null): string {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
  return `As of ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(hasTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : { timeZone: "UTC" })
  }).format(date)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function filterPoints(points: MarketPoint[], period: HistoryPeriod): MarketPoint[] {
  const latest = points.at(-1);
  if (!latest || period === "ALL") return points;
  const start = new Date(latest.timestamp);
  if (period === "YTD") start.setUTCMonth(0, 1);
  else {
    const days = period === "30D" ? 30 : period === "90D" ? 90 : 365;
    start.setUTCDate(start.getUTCDate() - days);
  }
  return points.filter((point) => new Date(point.timestamp) >= start);
}

function defaultPeriod(points: MarketPoint[], periods: HistoryPeriod[]): HistoryPeriod {
  for (const period of periods) {
    if (period !== "ALL" && filterPoints(points, period).length > 1) return period;
  }
  return "ALL";
}

function periodButtons(periods: HistoryPeriod[], active: HistoryPeriod, attribute: string): string {
  return `<div class="history-range terminal-history-range" aria-label="History range">
    <span>History</span>
    ${periods.map((period) => `<button type="button" ${attribute}="${period}" class="${period === active ? "is-active" : ""}">${period === "ALL" ? "All" : period}</button>`).join("")}
  </div>`;
}

interface ChartOptions {
  id: string;
  fixedExtent?: [number, number];
  scoreBands?: boolean;
  valueLabel: (value: number) => string;
}

function renderLineChart(container: HTMLElement, points: MarketPoint[], options: ChartOptions): void {
  if (points.length < 2) {
    container.innerHTML = '<span>Not enough verified observations in this window.</span>';
    container.classList.add("is-unavailable");
    return;
  }
  container.classList.remove("is-unavailable");
  const width = 760;
  const height = 236;
  const padding = { top: 22, right: 18, bottom: 34, left: 18 };
  const values = points.map((point) => point.value);
  const rawMin = options.fixedExtent?.[0] ?? Math.min(...values);
  const rawMax = options.fixedExtent?.[1] ?? Math.max(...values);
  const rawSpan = rawMax - rawMin || Math.abs(rawMax || 1) * 0.02;
  const minimum = options.fixedExtent ? rawMin : rawMin - rawSpan * 0.08;
  const maximum = options.fixedExtent ? rawMax : rawMax + rawSpan * 0.08;
  const span = maximum - minimum || 1;
  const x = (index: number) => padding.left + (index / (points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((maximum - value) / span) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height - padding.bottom} L${x(0).toFixed(1)} ${height - padding.bottom} Z`;
  const gradientId = `terminal-fill-${options.id}`;
  const lastIndex = points.length - 1;
  const gridLines = [0.25, 0.5, 0.75].map((ratio) => {
    const gridY = padding.top + ratio * (height - padding.top - padding.bottom);
    return `<path d="M${padding.left} ${gridY}H${width - padding.right}" class="market-chart-gridline"/>`;
  }).join("");
  const scoreBands = options.scoreBands
    ? `<path d="M${padding.left} ${y(0.25)}H${width - padding.right} M${padding.left} ${y(-0.25)}H${width - padding.right}" class="market-chart-threshold"/>`
    : "";
  container.innerHTML = `
    <div class="terminal-chart-readout" data-chart-readout><time>${escapeHtml(formatDate(points[lastIndex]!.timestamp))}</time><strong>${escapeHtml(options.valueLabel(points[lastIndex]!.value))}</strong></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dated historical line chart">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc8f4" stop-opacity=".28"/><stop offset="1" stop-color="#8fc8f4" stop-opacity="0"/></linearGradient></defs>
      ${gridLines}${scoreBands}
      <path d="${area}" fill="url(#${gradientId})"/>
      <path d="${line}" class="market-chart-line" pathLength="1"/>
      <line x1="${x(lastIndex)}" x2="${x(lastIndex)}" y1="${padding.top}" y2="${height - padding.bottom}" class="chart-hover-guide" data-chart-guide/>
      <circle cx="${x(lastIndex)}" cy="${y(points[lastIndex]!.value)}" r="5" class="market-chart-current" data-chart-dot/>
      <text x="${padding.left}" y="${height - 10}" class="market-chart-date">${escapeHtml(formatDate(points[0]!.timestamp))}</text>
      <text x="${width - padding.right}" y="${height - 10}" text-anchor="end" class="market-chart-date">${escapeHtml(formatDate(points[lastIndex]!.timestamp))}</text>
    </svg>`;

  const svg = container.querySelector<SVGElement>("svg")!;
  const guide = svg.querySelector<SVGLineElement>("[data-chart-guide]");
  const dot = svg.querySelector<SVGCircleElement>("[data-chart-dot]");
  const readout = container.querySelector<HTMLElement>("[data-chart-readout]");
  const inspect = (index: number) => {
    const point = points[index]!;
    const pointX = x(index);
    guide?.setAttribute("x1", pointX.toFixed(1));
    guide?.setAttribute("x2", pointX.toFixed(1));
    dot?.setAttribute("cx", pointX.toFixed(1));
    dot?.setAttribute("cy", y(point.value).toFixed(1));
    const date = readout?.querySelector("time");
    const value = readout?.querySelector("strong");
    if (date) date.textContent = formatDate(point.timestamp);
    if (value) value.textContent = options.valueLabel(point.value);
  };
  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    inspect(Math.round(ratio * lastIndex));
  });
  svg.addEventListener("pointerleave", () => inspect(lastIndex));
}

function renderQuotes(metrics: MarketMetric[]): void {
  const root = document.querySelector<HTMLElement>("[data-market-quotes]");
  if (!root) return;
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  root.innerHTML = quoteIds.map((id) => {
    const metric = byId.get(id);
    if (!metric) return "";
    const displayedValue = metric.value === null ? "Offline" : formatValue(metric);
    return `<article class="terminal-quote ${metric.status !== "ready" ? "is-unavailable" : ""}">
      <div><span>${escapeHtml(symbols[id] ?? metric.label)}</span><small>${escapeHtml(metric.label)}</small></div>
      <strong>${escapeHtml(displayedValue)}</strong>
      <b data-tone="${tone(metric.change)}">${escapeHtml(formatChange(metric))}</b>
      <time>${escapeHtml(formatAsOf(metric.asOf))}</time>
    </article>`;
  }).join("");
}

function updateRangeMeter(panel: HTMLElement, metric: MarketMetric, points: MarketPoint[]): void {
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const current = points.at(-1)?.value ?? metric.value;
  const position = current === null || !Number.isFinite(minimum) || maximum === minimum
    ? 50
    : ((current - minimum) / (maximum - minimum)) * 100;
  const marker = panel.querySelector<HTMLElement>("[data-range-marker]");
  if (marker) marker.style.left = `${Math.min(100, Math.max(0, position)).toFixed(1)}%`;
  const label = panel.querySelector<HTMLElement>("[data-range-position]");
  if (label) label.textContent = points.length > 1 ? `${position.toFixed(0)}%` : "--";
  const low = panel.querySelector<HTMLElement>("[data-range-low]");
  const high = panel.querySelector<HTMLElement>("[data-range-high]");
  if (low) low.textContent = points.length > 1 ? formatValue(metric, minimum) : "Low --";
  if (high) high.textContent = points.length > 1 ? formatValue(metric, maximum) : "High --";
}

function marketPanelMarkup(metric: MarketMetric, period: HistoryPeriod): string {
  return `<article class="terminal-panel ${metric.status !== "ready" ? "is-unavailable" : ""}" data-market-panel="${metric.id}">
    <header>
      <div><span>${escapeHtml(symbols[metric.id] ?? metric.frequency)}</span><h3>${escapeHtml(metric.label)}</h3></div>
      <div class="terminal-panel-metric"><strong>${escapeHtml(formatValue(metric))}</strong><b data-tone="${tone(metric.change)}">${escapeHtml(formatChange(metric))}</b></div>
    </header>
    ${metric.message ? `<p class="terminal-panel-note">${escapeHtml(metric.message)}</p>` : ""}
    <div class="terminal-panel-tools">
      ${periodButtons(marketPeriods, period, "data-market-period")}
      <div class="terminal-range-meter"><div><span>Range position</span><strong data-range-position>--</strong></div><i><b data-range-marker></b></i><small><span data-range-low>Low --</span><span data-range-high>High --</span></small></div>
    </div>
    <div class="terminal-chart" data-market-chart="${metric.id}"><span>Loading verified observations</span></div>
    <footer><span data-panel-range>${escapeHtml(formatAsOf(metric.asOf))}</span><a href="${escapeHtml(metric.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(metric.source)}</a></footer>
  </article>`;
}

function renderMarketPanels(metrics: MarketMetric[], ids: MarketMetricId[], selector: string): void {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return;
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const selected = ids.map((id) => byId.get(id)).filter((metric): metric is MarketMetric => Boolean(metric));
  const periods = new Map(selected.map((metric) => [metric.id, defaultPeriod(metric.points, marketPeriods)]));
  root.innerHTML = selected.map((metric) => marketPanelMarkup(metric, periods.get(metric.id)!)).join("");

  for (const metric of selected) {
    const panel = root.querySelector<HTMLElement>(`[data-market-panel="${metric.id}"]`)!;
    const render = () => {
      const period = periods.get(metric.id)!;
      const points = filterPoints(metric.points, period);
      const chart = panel.querySelector<HTMLElement>(`[data-market-chart="${metric.id}"]`)!;
      renderLineChart(chart, points, { id: `${metric.id}-${period}`, valueLabel: (value) => formatValue(metric, value) });
      updateRangeMeter(panel, metric, points);
      const range = panel.querySelector<HTMLElement>("[data-panel-range]");
      if (range) range.textContent = points.length > 1
        ? `${formatDate(points[0]!.timestamp)} - ${formatDate(points.at(-1)!.timestamp)}`
        : metric.historyMessage ?? formatAsOf(metric.asOf);
    };
    panel.querySelectorAll<HTMLButtonElement>("[data-market-period]").forEach((button) => {
      button.addEventListener("click", () => {
        periods.set(metric.id, button.dataset.marketPeriod as HistoryPeriod);
        panel.querySelectorAll<HTMLButtonElement>("[data-market-period]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        render();
      });
    });
    render();
  }
}

function setFeedState(selector: string, state: string, label: string): void {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return;
  root.dataset.state = state;
  const text = root.querySelector("span");
  if (text) text.textContent = label;
}

export async function bootTerminal(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-market-terminal]");
  if (!root) return;
  try {
    const markets = await apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(18_000) });
    renderQuotes(markets.metrics);
    renderMarketPanels(markets.metrics, cryptoIds, "[data-crypto-panels]");
    renderMarketPanels(markets.metrics, liquidityIds, "[data-liquidity-panels]");
    renderMarketPanels(markets.metrics, crossAssetIds, "[data-cross-asset-panels]");
    renderMarketPanels(markets.metrics, housingIds, "[data-housing-panels]");
    const cryptoMetrics = quoteIds.map((id) => markets.metrics.find((metric) => metric.id === id)).filter((metric): metric is MarketMetric => Boolean(metric));
    const cryptoReady = cryptoMetrics.filter((metric) => metric.status === "ready").length;
    const cryptoState = cryptoReady === cryptoMetrics.length ? "ready" : cryptoReady > 0 ? "partial" : "unavailable";
    setFeedState("[data-market-status]", cryptoState, cryptoState === "ready" ? "Crypto tape online" : cryptoState === "partial" ? "Crypto tape partial" : "Crypto tape unavailable");
    trackProductEvent("terminal_data_loaded", { status: markets.status, cryptoStatus: cryptoState });
  } catch {
    setFeedState("[data-market-status]", "unavailable", "Feeds temporarily unavailable");
    const quotes = document.querySelector<HTMLElement>("[data-market-quotes]");
    if (quotes) quotes.innerHTML = '<p class="terminal-loading-copy">Live market feeds are temporarily unavailable. No substitute prices are shown.</p>';
    trackProductEvent("terminal_data_failed", { reason: "request_failed" });
  }
}
