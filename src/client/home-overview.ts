import type {
  BitcoinValuationDashboard,
  MarketDashboard,
  MarketMetric,
  WorkbookBacktestResult,
  WorkbookDashboard,
  WorkbookScoreSeries
} from "../shared/contracts.js";
import { apiRequest } from "./api.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime())
    ? "Unavailable"
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

function valuationCard(valuation: BitcoinValuationDashboard | null): string {
  const minimum = valuation?.scaleMin ?? -1;
  const maximum = valuation?.scaleMax ?? 1;
  const position = valuation?.score === null || valuation?.score === undefined
    ? 50
    : Math.min(100, Math.max(0, ((valuation.score - minimum) / (maximum - minimum || 1)) * 100));
  const state = valuation?.state ?? "Unavailable";
  return `<article class="aq-overview-card aq-instrument-card aq-valuation-card">
    <header class="aq-instrument-head"><div><span>Valuation model</span><h3>Bitcoin valuation</h3></div><a href="valuation.html">Full analysis <i>↗</i></a></header>
    <div class="aq-instrument-reading"><div><span>Standardized score</span><strong>${formatScore(valuation?.score ?? null, "σ")}</strong></div><b class="${stateTone(state)}">${escapeHtml(state)}</b></div>
    <p class="aq-instrument-copy">Composite evidence showing where Bitcoin trades relative to the model’s independent valuation range.</p>
    <div class="aq-overview-scale" aria-label="Valuation scale from ${minimum.toFixed(2)} to ${maximum.toFixed(2)} standard deviations"><i style="left:${position.toFixed(2)}%"></i></div>
    <div class="aq-overview-scale-labels"><span>Lower value</span><span>Neutral</span><span>Higher value</span></div>
    <footer class="aq-instrument-meta"><span>${valuation?.workbookUpdatedLabel ? `Published ${formatDate(valuation.workbookUpdatedLabel)}` : "No published reading"}</span><span>${valuation?.indicatorCount ?? 0} model inputs</span></footer>
  </article>`;
}

function liquidityCard(markets: MarketDashboard | null): string {
  const liquidity = markets?.metrics.find((metric) => metric.id === "fedNetLiquidity");
  const points = liquidity?.points.map((point) => ({ date: point.timestamp, value: point.value })) ?? [];
  const publishedDate = formatDate(liquidity?.asOf);
  const weeklyChange = liquidity?.change === null || liquidity?.change === undefined
    ? "Weekly change pending"
    : `${liquidity.change > 0 ? "+" : ""}${liquidity.change.toFixed(2)}% weekly`;
  const changeTone = liquidity?.change === null || liquidity?.change === undefined
    ? "is-neutral"
    : liquidity.change >= 0 ? "is-positive" : "is-negative";
  return `<article class="aq-overview-card aq-instrument-card aq-liquidity-card">
    <header class="aq-instrument-head"><div><span>Macro liquidity</span><h3>Net Fed liquidity</h3></div><a href="liquidity.html">Full analysis <i>↗</i></a></header>
    <div class="aq-instrument-reading"><div><span>Current level</span><strong>${formatLiquidity(liquidity)}</strong></div><b class="${changeTone}">${escapeHtml(weeklyChange)}</b></div>
    <p class="aq-instrument-copy">${escapeHtml(liquidity?.message ?? "Federal Reserve balance-sheet liquidity after major offsetting facilities.")}</p>
    <div class="aq-instrument-chart">${sparkline(points, "Net Fed liquidity")}</div>
    <footer class="aq-instrument-meta"><span>${publishedDate === "Unavailable" ? "Update pending" : `Updated ${publishedDate}`}</span><span>${escapeHtml(liquidity?.frequency ?? "Weekly derived")}</span><span>${escapeHtml(liquidity?.source ?? "FRED-derived")}</span></footer>
  </article>`;
}

function researchCard(workbook: WorkbookDashboard | null): string {
  const observationCount = (workbook?.scoreSeries ?? []).reduce((total, series) => total + series.points.length, 0);
  const completedTests = workbook?.modelResults?.results.filter((result) => result.reviewStatus.toLowerCase() === "complete").length ?? 0;
  const publishedModels = (workbook?.signals ?? []).filter((signal) => signal.source === "google_sheets").length;
  return `<article class="aq-overview-card aq-research-record-card">
    <div class="aq-record-intro"><span>Evidence ledger</span><h3>Research record</h3><p>Published readings stay dated, source-traceable, and open to inspection as the market view changes.</p><a href="research.html">Open research archive <i>↗</i></a></div>
    <dl class="aq-record-metrics">
      <div><dt>Published models</dt><dd>${publishedModels || "--"}</dd></div>
      <div><dt>Dated observations</dt><dd>${observationCount || "--"}</dd></div>
      <div><dt>Completed tests</dt><dd>${completedTests || "--"}</dd></div>
    </dl>
    <nav class="aq-research-record-links" aria-label="Research record destinations">
      <a href="models.html#trend"><span><strong>Score history</strong><small>Inspect every published model reading.</small></span><i>↗</i></a>
      <a href="backtesting.html"><span><strong>Forward testing</strong><small>Review validation windows and diagnostics.</small></span><i>↗</i></a>
      <a href="methodology.html"><span><strong>Methodology</strong><small>Understand construction, scale, and limits.</small></span><i>↗</i></a>
    </nav>
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

function heroSnapshot(workbook: WorkbookDashboard | null, markets: MarketDashboard | null): string {
  const models = [
    { id: "sniper1d", label: "Total ES 1D" },
    { id: "mtpi", label: "MTPI Total" },
    { id: "btc1w", label: "BTC 1W" },
    { id: "ltpi", label: "Long-Term" }
  ];
  const signals = new Map(workbook?.signals.map((signal) => [signal.id, signal]));
  const signalRows = models.map((model) => {
    const signal = signals.get(model.id);
    const state = signal?.state ?? "Unavailable";
    const position = signal ? Math.min(100, Math.max(0, ((signal.value + 1) / 2) * 100)) : 50;
    return `<div class="aq-command-signal">
      <span>${escapeHtml(model.label)}</span>
      <div class="aq-command-rail"><i style="width:${position.toFixed(2)}%"></i></div>
      <strong>${formatScore(signal?.value ?? null)}</strong>
      <b class="${stateTone(state)}">${escapeHtml(state)}</b>
    </div>`;
  }).join("");
  const regime = signals.get("mtpi") ?? signals.get("sniper1d") ?? null;
  const regimeScore = regime?.value ?? null;
  const regimeState = regime?.state ?? "Unavailable";
  const needle = regimeScore === null ? 0 : Math.min(70, Math.max(-70, regimeScore * 70));
  const liquidity = markets?.metrics.find((metric) => metric.id === "fedNetLiquidity");
  const liquidityPoints = liquidity?.points.slice(-120).map((point) => ({ date: point.timestamp, value: point.value })) ?? [];
  const liquidityChange = liquidity?.change === null || liquidity?.change === undefined
    ? "Change pending"
    : `${liquidity.change > 0 ? "+" : ""}${liquidity.change.toFixed(2)}% weekly`;
  const liquidityTone = liquidity?.change === null || liquidity?.change === undefined
    ? "is-neutral"
    : liquidity.change >= 0 ? "is-positive" : "is-negative";

  return `<article class="aq-command-panel aq-signal-panel">
    <header><div><span class="aq-panel-icon" aria-hidden="true">⌁</span><h2>Published model stack</h2></div><a href="models.html#trend">View all <i>→</i></a></header>
    <nav class="aq-command-tabs" aria-label="Model stack categories"><span class="is-active">Trend</span><span>Bitcoin</span><span>Rates</span></nav>
    <div class="aq-command-signal-list">${signalRows}</div>
    <footer><span>Standardized scale</span><strong>−1.00 <i>to</i> +1.00</strong></footer>
  </article>
  <article class="aq-command-panel aq-regime-panel">
    <header><div><span class="aq-panel-icon" aria-hidden="true">◎</span><h2>Medium-term market regime</h2></div><span class="aq-live-indicator"><i></i>Live model</span></header>
    <div class="aq-regime-dial" style="--aq-needle:${needle.toFixed(2)}deg">
      <div class="aq-dial-arc" aria-hidden="true"></div>
      <div class="aq-dial-labels" aria-hidden="true"><span>Risk-off</span><span>Transition</span><span>Risk-on</span></div>
      <div class="aq-dial-needle" aria-hidden="true"><i></i></div>
      <div class="aq-dial-copy"><small>${escapeHtml(regime?.name ?? "MTPI Total")}</small><strong>${formatScore(regimeScore)}</strong><b class="${stateTone(regimeState)}">${escapeHtml(regimeState)}</b></div>
    </div>
    <div class="aq-regime-brief"><span aria-hidden="true">↗</span><p>${regime ? `Published ${escapeHtml(regime.name)} reading from ${escapeHtml(regime.sourceTab ?? "the research workbook")}.` : "The published medium-term regime feed is temporarily unavailable."}</p></div>
    <footer><span>Latest observation</span><strong>${escapeHtml(formatDate(regime?.updatedLabel))}</strong></footer>
  </article>
  <article class="aq-command-panel aq-liquidity-panel">
    <header><div><span class="aq-panel-icon" aria-hidden="true">▥</span><h2>Net Fed Liquidity</h2></div><a href="liquidity.html">View details <i>→</i></a></header>
    <div class="aq-liquidity-reading"><strong>${formatLiquidity(liquidity)}</strong><span class="${liquidityTone}">${escapeHtml(liquidityChange)}</span></div>
    <p>Federal Reserve balance-sheet liquidity after Treasury General Account and reverse-repo offsets.</p>
    <div class="aq-command-chart">${sparkline(liquidityPoints, "Net Fed Liquidity")}</div>
    <footer><span>${liquidity?.asOf ? `Updated ${escapeHtml(formatDate(liquidity.asOf))}` : "Update pending"}</span><strong>${escapeHtml(liquidity?.source ?? "FRED-derived")}</strong></footer>
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

  overview.innerHTML = `${valuationCard(valuation)}${liquidityCard(markets)}${researchCard(workbook)}`;
  if (snapshot) snapshot.innerHTML = heroSnapshot(workbook, markets);
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
