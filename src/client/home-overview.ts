import type {
  BitcoinValuationDashboard,
  MarketDashboard,
  MarketMetric,
  WorkbookDashboard,
  WorkbookModelSignal,
  WorkbookScoreSeries
} from "../shared/contracts.js";
import { apiRequest } from "./api.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function formatScore(value: number | null, suffix = ""): string {
  if (value === null) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function formatLiquidity(metric: MarketMetric | undefined): string {
  if (!metric || metric.value === null) return "--";
  if (metric.unit === "usd_millions") return `$${(metric.value / 1_000_000).toFixed(3)}T`;
  if (metric.unit === "usd_billions") return `$${(metric.value / 1_000).toFixed(3)}T`;
  if (metric.unit === "usd") return `$${(metric.value / 1_000_000_000_000).toFixed(3)}T`;
  return `$${metric.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function sparkline(points: Array<{ date: string; value: number }>, label: string): string {
  if (points.length < 2) return '<div class="aq-overview-sparkline is-unavailable">History unavailable</div>';
  const width = 280;
  const height = 66;
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const path = points.map((point, index) => {
    const x = 3 + (index / (points.length - 1)) * (width - 6);
    const y = 5 + ((maximum - point.value) / span) * (height - 10);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const area = `${path} L${width - 3} ${height - 3} L3 ${height - 3} Z`;
  return `<div class="aq-overview-sparkline"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} history"><path class="aq-overview-spark-area" d="${area}"/><path class="aq-overview-spark-line" d="${path}"/></svg></div>`;
}

function stateTone(state: string | null | undefined): string {
  const normalized = state?.toLowerCase() ?? "";
  if (/(risk-on|easing|inexpensive|undervalued|high value)/.test(normalized)) return "is-positive";
  if (/(risk-off|tightening|expensive|overvalued|no value)/.test(normalized)) return "is-negative";
  return "is-neutral";
}

function trendReading(series: WorkbookScoreSeries | undefined, signal: WorkbookModelSignal | undefined, label: string): string {
  const latest = series?.points.at(-1);
  const state = signal?.state ?? "Unavailable";
  return `<div class="aq-trend-reading">
    <span>${escapeHtml(label)}</span>
    <strong>${formatScore(latest?.score ?? null)}</strong>
    <b class="${stateTone(state)}">${escapeHtml(state)}</b>
    ${sparkline((series?.points ?? []).map((point) => ({ date: point.date, value: point.score })), `${label} trend`)}
    <small>${latest ? formatDate(latest.date) : "No published observation"}</small>
  </div>`;
}

function trendCard(workbook: WorkbookDashboard | null): string {
  const series = new Map(workbook?.scoreSeries.map((item) => [item.id, item]));
  const signals = new Map(workbook?.signals.map((item) => [item.id, item]));
  return `<article class="aq-overview-card aq-overview-card-trend">
    <div class="aq-overview-card-head"><div><span>Trend</span><p>Published probability modules</p></div><a href="models.html">Explore trend <i>↗</i></a></div>
    <div class="aq-trend-readings">${trendReading(series.get("mtpi"), signals.get("mtpi"), "Medium-term")}${trendReading(series.get("ltpi"), signals.get("ltpi"), "Long-term")}</div>
  </article>`;
}

function valuationCard(valuation: BitcoinValuationDashboard | null): string {
  const minimum = valuation?.scaleMin ?? -1;
  const maximum = valuation?.scaleMax ?? 1;
  const position = valuation?.score === null || valuation?.score === undefined
    ? 50
    : Math.min(100, Math.max(0, ((valuation.score - minimum) / (maximum - minimum || 1)) * 100));
  const state = valuation?.state ?? "Unavailable";
  return `<article class="aq-overview-card">
    <div class="aq-overview-card-head"><div><span>Bitcoin valuation</span><p>Composite valuation context</p></div><a href="valuation.html">Explore valuation <i>↗</i></a></div>
    <div class="aq-valuation-summary"><strong>${formatScore(valuation?.score ?? null, "σ")}</strong><b class="${stateTone(state)}">${escapeHtml(state)}</b><small>${valuation?.workbookUpdatedLabel ? `Published ${formatDate(valuation.workbookUpdatedLabel)}` : "No published reading"}</small></div>
    <div class="aq-overview-scale" aria-label="Valuation scale from ${minimum.toFixed(2)} to ${maximum.toFixed(2)} standard deviations"><i style="left:${position.toFixed(2)}%"></i></div>
    <div class="aq-overview-scale-labels"><span>${minimum.toFixed(1)}σ</span><span>0σ</span><span>${maximum.toFixed(1)}σ</span></div>
  </article>`;
}

function liquidityCard(markets: MarketDashboard | null): string {
  const liquidity = markets?.metrics.find((metric) => metric.id === "fedNetLiquidity");
  const points = liquidity?.points.map((point) => ({ date: point.timestamp, value: point.value })) ?? [];
  return `<article class="aq-overview-card">
    <div class="aq-overview-card-head"><div><span>Net Fed liquidity</span><p>Five-component balance-sheet series</p></div><a href="models.html#net-fed-liquidity">Explore liquidity <i>↗</i></a></div>
    <div class="aq-liquidity-summary"><strong>${formatLiquidity(liquidity)}</strong><small>${liquidity?.asOf ? `Updated ${formatDate(liquidity.asOf)}` : "No published reading"}</small></div>
    ${sparkline(points, "Net Fed liquidity")}
  </article>`;
}

function researchCard(): string {
  return `<article class="aq-overview-card aq-research-record-card">
    <div class="aq-overview-card-head"><div><span>Research record</span><p>Inspect the published evidence</p></div><a href="research.html">View research record <i>↗</i></a></div>
    <div class="aq-research-record-links">
      <a href="models.html"><span>Published score history</span><i>↗</i></a>
      <a href="backtesting.html"><span>Forward-test diagnostics</span><i>↗</i></a>
      <a href="research.html"><span>Research records</span><i>↗</i></a>
    </div>
  </article>`;
}

function historyMarkup(series: WorkbookScoreSeries): string {
  const points = series.points;
  if (!points.length) return '<p class="aq-history-empty">No dated observations are currently published for this model.</p>';

  const width = 1000;
  const height = 330;
  const padding = { top: 24, right: 30, bottom: 48, left: 56 };
  const values = points.map((point) => point.score);
  const minimum = Math.min(-1, ...values);
  const maximum = Math.max(1, ...values);
  const span = maximum - minimum || 1;
  const timestamps = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const start = timestamps[0]!;
  const range = timestamps.at(-1)! - start || 1;
  const x = (index: number) => padding.left + ((timestamps[index]! - start) / range) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((maximum - value) / span) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${y(minimum).toFixed(1)} L${x(0).toFixed(1)} ${y(minimum).toFixed(1)} Z`;
  const latestIndex = points.length - 1;
  const dateTicks = [...new Set([0, Math.round(latestIndex / 3), Math.round(latestIndex * 2 / 3), latestIndex])];
  const yTicks = [maximum, .25, 0, -.25, minimum].filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]!) > .001);
  const observations = [...points].reverse().map((point) => `<li><time>${escapeHtml(formatDate(point.date))}</time><strong>${formatScore(point.score)}</strong></li>`).join("");
  const latest = points[latestIndex]!;

  return `<div class="aq-history-chart-wrap">
    <div class="aq-history-readout" data-home-history-readout><span>Selected observation</span><time>${escapeHtml(formatDate(latest.date))}</time><strong>${formatScore(latest.score)}</strong></div>
    <svg class="aq-history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.label)} historical score chart" data-home-history-chart>
      <rect x="${padding.left}" y="${y(1).toFixed(1)}" width="${width - padding.left - padding.right}" height="${Math.max(0, y(.25) - y(1)).toFixed(1)}" class="aq-history-band is-positive"/>
      <rect x="${padding.left}" y="${y(.25).toFixed(1)}" width="${width - padding.left - padding.right}" height="${Math.max(0, y(-.25) - y(.25)).toFixed(1)}" class="aq-history-band is-neutral"/>
      <rect x="${padding.left}" y="${y(-.25).toFixed(1)}" width="${width - padding.left - padding.right}" height="${Math.max(0, y(-1) - y(-.25)).toFixed(1)}" class="aq-history-band is-negative"/>
      ${yTicks.map((value) => `<g><line x1="${padding.left}" x2="${width - padding.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="aq-history-gridline"/><text x="${padding.left - 10}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" class="aq-history-y-label">${formatScore(value)}</text></g>`).join("")}
      ${dateTicks.map((index) => `<g><line x1="${x(index).toFixed(1)}" x2="${x(index).toFixed(1)}" y1="${padding.top}" y2="${height - padding.bottom}" class="aq-history-gridline is-vertical"/><text x="${x(index).toFixed(1)}" y="${height - 16}" text-anchor="middle" class="aq-history-x-label">${escapeHtml(formatDate(points[index]!.date))}</text></g>`).join("")}
      <path d="${area}" class="aq-history-area"/>
      <path d="${line}" class="aq-history-line"/>
      <line x1="${x(latestIndex).toFixed(1)}" x2="${x(latestIndex).toFixed(1)}" y1="${padding.top}" y2="${height - padding.bottom}" class="aq-history-guide" data-home-history-guide/>
      <circle cx="${x(latestIndex).toFixed(1)}" cy="${y(latest.score).toFixed(1)}" r="5" class="aq-history-dot" data-home-history-dot/>
      <rect x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="transparent" data-home-history-hit/>
    </svg>
  </div>
  <div class="aq-history-legend"><span><i class="is-positive"></i>Risk-on</span><span><i class="is-neutral"></i>Neutral</span><span><i class="is-negative"></i>Risk-off</span><small>${escapeHtml(series.label)} / ${points.length} dated observations</small></div>
  <details class="aq-history-observations"><summary>View dated observations</summary><ol>${observations}</ol></details>`;
}

function bindHistory(root: HTMLElement, series: WorkbookScoreSeries): void {
  const chart = root.querySelector<SVGElement>("[data-home-history-chart]");
  const guide = root.querySelector<SVGLineElement>("[data-home-history-guide]");
  const dot = root.querySelector<SVGCircleElement>("[data-home-history-dot]");
  const readout = root.querySelector<HTMLElement>("[data-home-history-readout]");
  if (!chart || !guide || !dot || !readout || !series.points.length) return;

  const points = series.points;
  const width = 1000;
  const height = 330;
  const padding = { top: 24, right: 30, bottom: 48, left: 56 };
  const values = points.map((point) => point.score);
  const minimum = Math.min(-1, ...values);
  const maximum = Math.max(1, ...values);
  const span = maximum - minimum || 1;
  const timestamps = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const start = timestamps[0]!;
  const range = timestamps.at(-1)! - start || 1;
  const x = (index: number) => padding.left + ((timestamps[index]! - start) / range) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((maximum - value) / span) * (height - padding.top - padding.bottom);

  const inspect = (index: number) => {
    const point = points[index]!;
    const pointX = x(index).toFixed(1);
    guide.setAttribute("x1", pointX);
    guide.setAttribute("x2", pointX);
    dot.setAttribute("cx", pointX);
    dot.setAttribute("cy", y(point.score).toFixed(1));
    readout.innerHTML = `<span>Selected observation</span><time>${escapeHtml(formatDate(point.date))}</time><strong>${formatScore(point.score)}</strong>`;
  };

  const inspectPointer = (event: PointerEvent) => {
    const rect = chart.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const target = padding.left + ratio * (width - padding.left - padding.right);
    let selected = 0;
    let nearest = Number.POSITIVE_INFINITY;
    points.forEach((_, index) => {
      const distance = Math.abs(x(index) - target);
      if (distance < nearest) {
        nearest = distance;
        selected = index;
      }
    });
    inspect(selected);
  };

  chart.addEventListener("pointermove", inspectPointer);
  chart.addEventListener("pointerdown", inspectPointer);
}

function newestPublishedDate(workbook: WorkbookDashboard | null, valuation: BitcoinValuationDashboard | null, markets: MarketDashboard | null): string | null {
  const liquidity = markets?.metrics.find((metric) => metric.id === "fedNetLiquidity");
  const candidates = [
    ...((workbook?.signals ?? []).map((signal) => signal.updatedLabel)),
    valuation?.workbookUpdatedLabel,
    liquidity?.asOf
  ].filter((value): value is string => Boolean(value));
  return candidates.sort((left, right) => Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`))[0] ?? null;
}

export async function bootHomeOverview(): Promise<void> {
  const overview = document.querySelector<HTMLElement>("[data-home-overview]");
  const history = document.querySelector<HTMLElement>("[data-home-history]");
  const updated = document.querySelector<HTMLTimeElement>("[data-overview-updated]");
  if (!overview || !history) return;

  const [workbookResult, valuationResult, marketsResult] = await Promise.allSettled([
    apiRequest<WorkbookDashboard>("/api/workbook", { signal: AbortSignal.timeout(12_000) }),
    apiRequest<BitcoinValuationDashboard>("/api/valuation", { signal: AbortSignal.timeout(12_000) }),
    apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(12_000) })
  ]);
  const workbook = workbookResult.status === "fulfilled" ? workbookResult.value : null;
  const valuation = valuationResult.status === "fulfilled" ? valuationResult.value : null;
  const markets = marketsResult.status === "fulfilled" ? marketsResult.value : null;

  overview.innerHTML = `${trendCard(workbook)}${valuationCard(valuation)}${liquidityCard(markets)}${researchCard()}`;
  if (updated) updated.textContent = formatDate(newestPublishedDate(workbook, valuation, markets));

  const seriesById = new Map(workbook?.scoreSeries.map((series) => [series.id, series]));
  const renderHistory = (seriesId: "mtpi" | "ltpi") => {
    const series = seriesById.get(seriesId);
    if (!series) {
      history.innerHTML = '<p class="aq-history-empty">Published trend history is temporarily unavailable.</p>';
      return;
    }
    history.innerHTML = historyMarkup(series);
    bindHistory(history, series);
  };

  document.querySelectorAll<HTMLButtonElement>("[data-home-history-series]").forEach((button) => {
    button.addEventListener("click", () => {
      const seriesId = button.dataset.homeHistorySeries as "mtpi" | "ltpi";
      document.querySelectorAll<HTMLButtonElement>("[data-home-history-series]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderHistory(seriesId);
    });
  });
  renderHistory("mtpi");
}
