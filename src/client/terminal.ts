import type { MarketDashboard, MarketMetric, MarketPoint } from "../shared/contracts.js";
import { apiRequest } from "./api.js";
import { trackProductEvent } from "./analytics.js";

const svgNamespace = "http://www.w3.org/2000/svg";

function formatValue(metric: MarketMetric): string {
  if (metric.value === null) return "Unavailable";
  if (metric.unit === "percent") return `${metric.value.toFixed(2)}%`;
  if (metric.unit === "index") return metric.value.toFixed(1);
  if (metric.unit === "usd_millions") {
    return `$${(metric.value / 1_000_000).toFixed(2)}T`;
  }
  if (metric.unit === "usd_compact") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(metric.value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: metric.value >= 1_000 ? 0 : 2
  }).format(metric.value);
}

function formatChange(metric: MarketMetric): string {
  if (metric.change === null) return "Change unavailable";
  const prefix = metric.change > 0 ? "+" : "";
  return metric.changeType === "basis_points"
    ? `${prefix}${metric.change.toFixed(0)} bps latest`
    : `${prefix}${metric.change.toFixed(2)}%${metric.id === "bitcoin" || metric.id === "ethereum" || metric.id === "total" || metric.id === "total2" ? " 24h" : " latest"}`;
}

function formatAsOf(value: string | null): string {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
  return `As of ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(hasTime
      ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" }
      : { timeZone: "UTC" })
  }).format(date)}`;
}

function setText(root: Element, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function pointPath(points: MarketPoint[], width: number, height: number, padding: number): string {
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  return points
    .map((point, index) => {
      const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y = padding + ((maximum - point.value) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderChart(container: HTMLElement, metric: MarketMetric): void {
  container.replaceChildren();
  if (metric.historyStatus !== "ready" || metric.points.length < 2) {
    const message = document.createElement("span");
    message.textContent = metric.historyMessage ?? "Historical observations unavailable.";
    container.append(message);
    container.classList.add("is-unavailable");
    return;
  }

  const width = 640;
  const height = container.classList.contains("terminal-chart-compact") ? 190 : 230;
  const padding = 12;
  const pathData = pointPath(metric.points, width, height, padding);
  const gradientId = `chart-fill-${metric.id}`;
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${metric.label} historical chart`);

  const definitions = document.createElementNS(svgNamespace, "defs");
  const gradient = document.createElementNS(svgNamespace, "linearGradient");
  gradient.id = gradientId;
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y2", "1");
  for (const [offset, opacity] of [["0%", "0.32"], ["100%", "0"]] as const) {
    const stop = document.createElementNS(svgNamespace, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", "#75bfff");
    stop.setAttribute("stop-opacity", opacity);
    gradient.append(stop);
  }
  definitions.append(gradient);
  svg.append(definitions);

  const grid = document.createElementNS(svgNamespace, "path");
  grid.setAttribute("d", `M0 ${height * 0.25}H${width} M0 ${height * 0.5}H${width} M0 ${height * 0.75}H${width}`);
  grid.setAttribute("class", "market-chart-gridline");
  svg.append(grid);

  const area = document.createElementNS(svgNamespace, "path");
  area.setAttribute("d", `${pathData} L${width - padding} ${height - padding} L${padding} ${height - padding} Z`);
  area.setAttribute("fill", `url(#${gradientId})`);
  svg.append(area);

  const line = document.createElementNS(svgNamespace, "path");
  line.setAttribute("d", pathData);
  line.setAttribute("class", "market-chart-line");
  svg.append(line);
  container.append(svg);
}

function renderMetric(metric: MarketMetric): void {
  const card = document.querySelector<HTMLElement>(`[data-market-card="${metric.id}"]`);
  if (card) {
    card.classList.toggle("is-unavailable", metric.status !== "ready");
    setText(card, "[data-market-value]", formatValue(metric));
    const changeElement = card.querySelector<HTMLElement>("[data-market-change]");
    if (changeElement) {
      changeElement.textContent = formatChange(metric);
      changeElement.dataset.tone = metric.change === null ? "neutral" : metric.change >= 0 ? "positive" : "negative";
    }
    setText(card, "[data-market-asof]", formatAsOf(metric.asOf));
  }

  const panel = document.querySelector<HTMLElement>(`[data-market-panel="${metric.id}"]`);
  if (!panel) return;
  panel.classList.toggle("is-unavailable", metric.status !== "ready");
  setText(panel, "[data-panel-value]", formatValue(metric));
  setText(panel, "[data-panel-change]", formatChange(metric));
  const range = metric.points.length > 1
    ? `${formatAsOf(metric.points[0]!.timestamp).replace("As of ", "")} - ${formatAsOf(metric.points.at(-1)!.timestamp).replace("As of ", "")}`
    : formatAsOf(metric.asOf);
  setText(panel, "[data-panel-range]", range);
  const source = panel.querySelector<HTMLAnchorElement>("[data-panel-source]");
  if (source) {
    source.href = metric.sourceUrl;
    source.textContent = metric.source;
  }
  const chart = panel.querySelector<HTMLElement>(`[data-market-chart="${metric.id}"]`);
  if (chart) renderChart(chart, metric);
}

export async function bootTerminal(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-market-terminal]");
  if (!root) return;
  const status = root.querySelector<HTMLElement>("[data-market-status]");
  try {
    const dashboard = await apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(18_000) });
    dashboard.metrics.forEach(renderMetric);
    trackProductEvent("terminal_data_loaded", { status: dashboard.status });
    if (status) {
      status.dataset.state = dashboard.status;
      setText(status, "span", dashboard.status === "ready" ? "Feeds online" : dashboard.status === "partial" ? "Partial feed" : "Feeds unavailable");
    }
  } catch {
    trackProductEvent("terminal_data_failed", { reason: "request_failed" });
    if (status) {
      status.dataset.state = "unavailable";
      setText(status, "span", "Feeds temporarily unavailable");
    }
    document.querySelectorAll<HTMLElement>("[data-market-value], [data-panel-value]").forEach((element) => {
      element.textContent = "Unavailable";
    });
  }
}
