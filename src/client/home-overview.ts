import type {
  BitcoinValuationDashboard,
  MarketDashboard,
  MarketMetric,
  WorkbookBacktestResult,
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

function trendRegime(score: number): "Risk-on" | "Risk-off" {
  return score >= 0 ? "Risk-on" : "Risk-off";
}

function trendTone(score: number): "positive" | "negative" {
  return score >= 0 ? "positive" : "negative";
}

function trendReading(series: WorkbookScoreSeries | undefined, signal: WorkbookModelSignal | undefined, label: string): string {
  const latest = series?.points.at(-1);
  const currentScore = signal?.value ?? latest?.score ?? null;
  const state = currentScore === null ? "Unavailable" : trendRegime(currentScore);
  return `<div class="aq-trend-reading">
    <div><span>${escapeHtml(label)}</span><small>${escapeHtml(signal?.sourceTab ?? "Published model")}</small></div>
    <strong>${formatScore(currentScore)}</strong>
    <b class="${stateTone(state)}">${escapeHtml(state)}</b>
    <time>${signal?.updatedLabel ? formatDate(signal.updatedLabel) : latest ? formatDate(latest.date) : "No published observation"}</time>
  </div>`;
}

function trendCard(workbook: WorkbookDashboard | null): string {
  const series = new Map(workbook?.scoreSeries.map((item) => [item.id, item]));
  const signals = new Map(workbook?.signals.map((item) => [item.id, item]));
  return `<article class="aq-overview-card aq-overview-card-trend">
    <div class="aq-overview-card-head"><div><span>Trend regime</span><p>Four horizons. One published view.</p></div><a href="models.html#trend">Open trend research <i>↗</i></a></div>
    <div class="aq-trend-readings">${trendReading(series.get("sniper1d"), signals.get("sniper1d"), "Total ES 1D")}${trendReading(series.get("mtpi"), signals.get("mtpi"), "MTPI Total")}${trendReading(series.get("btc1w"), signals.get("btc1w"), "BTC 1W")}${trendReading(series.get("ltpi"), signals.get("ltpi"), "Long-Term Trend")}</div>
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
    <div class="aq-overview-card-head"><div><span>Bitcoin valuation</span><p>Price relative to independent value</p></div><a href="valuation.html">Open valuation <i>↗</i></a></div>
    <div class="aq-valuation-summary"><strong>${formatScore(valuation?.score ?? null, "σ")}</strong><b class="${stateTone(state)}">${escapeHtml(state)}</b><small>${valuation?.workbookUpdatedLabel ? `Published ${formatDate(valuation.workbookUpdatedLabel)}` : "No published reading"}</small></div>
    <div class="aq-overview-scale" aria-label="Valuation scale from ${minimum.toFixed(2)} to ${maximum.toFixed(2)} standard deviations"><i style="left:${position.toFixed(2)}%"></i></div>
    <div class="aq-overview-scale-labels"><span>${minimum.toFixed(1)}σ</span><span>0σ</span><span>${maximum.toFixed(1)}σ</span></div>
  </article>`;
}

function liquidityCard(markets: MarketDashboard | null): string {
  const liquidity = markets?.metrics.find((metric) => metric.id === "fedNetLiquidity");
  const points = liquidity?.points.map((point) => ({ date: point.timestamp, value: point.value })) ?? [];
  return `<article class="aq-overview-card">
    <div class="aq-overview-card-head"><div><span>Net Fed liquidity</span><p>Macro liquidity beneath the market</p></div><a href="models.html#liquidity">Open liquidity <i>↗</i></a></div>
    <div class="aq-liquidity-summary"><strong>${formatLiquidity(liquidity)}</strong><small>${liquidity?.asOf ? `Updated ${formatDate(liquidity.asOf)}` : "No published reading"}</small></div>
    ${sparkline(points, "Net Fed liquidity")}
  </article>`;
}

function researchCard(): string {
  return `<article class="aq-overview-card aq-research-record-card">
    <div class="aq-overview-card-head"><div><span>Research record</span><p>Nothing disappears when the view changes.</p></div><a href="research.html">View the record <i>↗</i></a></div>
    <div class="aq-research-record-links">
      <a href="models.html#trend"><span>Score history</span><i>↗</i></a>
      <a href="backtesting.html"><span>Forward testing</span><i>↗</i></a>
      <a href="methodology.html"><span>Methodology</span><i>↗</i></a>
    </div>
  </article>`;
}

function performanceModelName(result: WorkbookBacktestResult): string {
  if (result.model === "TOTALES") return "Total ES";
  if (result.model.endsWith("USD")) return result.model.slice(0, -3);
  return result.model;
}

function selectPerformanceResults(workbook: WorkbookDashboard | null): WorkbookBacktestResult[] {
  const complete = (workbook?.modelResults?.results ?? []).filter((result) => result.reviewStatus.toLowerCase() === "complete");
  const preferred = [
    (result: WorkbookBacktestResult) => result.model === "TOTALES" && result.startDate === "2019-01-01",
    (result: WorkbookBacktestResult) => result.model === "TOTALES" && /rolling 36 months/i.test(result.window),
    (result: WorkbookBacktestResult) => result.model === "ETHUSD" && /rolling 36 months/i.test(result.window)
  ];
  const selected: WorkbookBacktestResult[] = [];
  preferred.forEach((predicate) => {
    const result = complete.find(predicate);
    if (result && !selected.includes(result)) selected.push(result);
  });
  complete.forEach((result) => {
    if (selected.length < 3 && !selected.includes(result)) selected.push(result);
  });
  return selected;
}

function performanceMarkup(workbook: WorkbookDashboard | null): string {
  const modelResults = workbook?.modelResults;
  const results = selectPerformanceResults(workbook);
  if (!modelResults || modelResults.status !== "ready" || !results.length) {
    return '<article class="aq-performance-unavailable"><strong>Model evidence is temporarily unavailable.</strong><span>No substitute performance figures are shown.</span></article>';
  }
  return `<div class="aq-performance-summary">
    <div><span>Source</span><strong>${escapeHtml(modelResults.sourceTab)}</strong></div>
    <div><span>As of</span><strong>${escapeHtml(formatDate(modelResults.asOf))}</strong></div>
    <div><span>Completed tests</span><strong>${modelResults.results.filter((result) => result.reviewStatus.toLowerCase() === "complete").length}</strong></div>
  </div>
  <div class="aq-performance-cards">${results.map((result) => `<article class="aq-performance-card">
    <header><div><span>${escapeHtml(result.window)}</span><h3>${escapeHtml(performanceModelName(result))} <i>${escapeHtml(result.timeframe)}</i></h3></div><b>Complete</b></header>
    <div class="aq-performance-primary"><span>Net profit</span><strong>${escapeHtml(result.netProfit)}</strong></div>
    <dl>
      <div><dt>Sharpe</dt><dd>${escapeHtml(result.sharpe)}</dd></div>
      <div><dt>Max equity DD</dt><dd>${escapeHtml(result.maxEquityDrawdown)}</dd></div>
      <div><dt>Profit factor</dt><dd>${escapeHtml(result.profitFactor)}</dd></div>
      <div><dt>Trades</dt><dd>${escapeHtml(result.trades)}</dd></div>
    </dl>
    <footer><span>${escapeHtml(formatDate(result.startDate))}</span><i>to</i><span>${escapeHtml(formatDate(result.endDate))}</span></footer>
  </article>`).join("")}</div>`;
}

function heroSnapshot(workbook: WorkbookDashboard | null): string {
  const models = [
    { id: "sniper1d", label: "Total ES 1D", horizon: "Daily total-market regime" },
    { id: "mtpi", label: "MTPI Total", horizon: "Medium-term trend" },
    { id: "btc1w", label: "BTC 1W", horizon: "Bitcoin weekly structure" },
    { id: "ltpi", label: "Long-Term Trend", horizon: "Long-horizon market structure" }
  ];
  const signals = new Map(workbook?.signals.map((signal) => [signal.id, signal]));
  return models.map((model) => {
    const signal = signals.get(model.id);
    const state = signal?.state ?? "Unavailable";
    return `<div class="aq-snapshot-row">
      <div><span>${escapeHtml(model.label)}</span><small>${escapeHtml(signal?.sourceTab ?? model.horizon)}</small></div>
      <strong>${formatScore(signal?.value ?? null)}</strong>
      <b class="${stateTone(state)}">${escapeHtml(state)}</b>
    </div>`;
  }).join("");
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
    <div class="aq-history-readout" data-home-history-readout data-tone="${trendTone(latest.score)}"><span>Selected observation</span><time>${escapeHtml(formatDate(latest.date))}</time><b>${trendRegime(latest.score)}</b><strong>${formatScore(latest.score)}</strong></div>
    <svg class="aq-history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.label)} historical score chart" data-home-history-chart>
      <rect x="${padding.left}" y="${y(1).toFixed(1)}" width="${width - padding.left - padding.right}" height="${Math.max(0, y(0) - y(1)).toFixed(1)}" class="aq-history-band is-positive"/>
      <rect x="${padding.left}" y="${y(0).toFixed(1)}" width="${width - padding.left - padding.right}" height="${Math.max(0, y(-1) - y(0)).toFixed(1)}" class="aq-history-band is-negative"/>
      ${yTicks.map((value) => `<g><line x1="${padding.left}" x2="${width - padding.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="aq-history-gridline"/><text x="${padding.left - 10}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" class="aq-history-y-label">${formatScore(value)}</text></g>`).join("")}
      ${dateTicks.map((index) => `<g><line x1="${x(index).toFixed(1)}" x2="${x(index).toFixed(1)}" y1="${padding.top}" y2="${height - padding.bottom}" class="aq-history-gridline is-vertical"/><text x="${x(index).toFixed(1)}" y="${height - 16}" text-anchor="middle" class="aq-history-x-label">${escapeHtml(formatDate(points[index]!.date))}</text></g>`).join("")}
      <path d="${area}" class="aq-history-area"/>
      <path d="${line}" class="aq-history-line"/>
      <line x1="${x(latestIndex).toFixed(1)}" x2="${x(latestIndex).toFixed(1)}" y1="${padding.top}" y2="${height - padding.bottom}" class="aq-history-guide" data-home-history-guide/>
      <circle cx="${x(latestIndex).toFixed(1)}" cy="${y(latest.score).toFixed(1)}" r="5" class="aq-history-dot" data-home-history-dot/>
      <rect x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="transparent" data-home-history-hit/>
    </svg>
  </div>
  <div class="aq-history-legend"><span class="is-positive"><i></i>Risk-on <em>0 to +1</em></span><span class="is-negative"><i></i>Risk-off <em>0 to -1</em></span><small>${escapeHtml(series.label)} / ${points.length} dated observations</small></div>
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
    const tone = trendTone(point.score);
    guide.classList.toggle("is-positive", tone === "positive");
    guide.classList.toggle("is-negative", tone === "negative");
    dot.classList.toggle("is-positive", tone === "positive");
    dot.classList.toggle("is-negative", tone === "negative");
    readout.dataset.tone = tone;
    readout.innerHTML = `<span>Selected observation</span><time>${escapeHtml(formatDate(point.date))}</time><b>${trendRegime(point.score)}</b><strong>${formatScore(point.score)}</strong>`;
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
  inspect(points.length - 1);
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
  const snapshot = document.querySelector<HTMLElement>("[data-home-hero-snapshot]");
  const performance = document.querySelector<HTMLElement>("[data-home-performance]");
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
  if (snapshot) snapshot.innerHTML = heroSnapshot(workbook);
  if (performance) performance.innerHTML = performanceMarkup(workbook);
  if (updated) updated.textContent = formatDate(newestPublishedDate(workbook, valuation, markets));

  const seriesById = new Map(workbook?.scoreSeries.map((series) => [series.id, series]));
  const renderHistory = (seriesId: WorkbookScoreSeries["id"]) => {
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
      const seriesId = button.dataset.homeHistorySeries as WorkbookScoreSeries["id"];
      document.querySelectorAll<HTMLButtonElement>("[data-home-history-series]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderHistory(seriesId);
    });
  });
  renderHistory("sniper1d");
}
