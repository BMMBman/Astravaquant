import type {
  MarketPoint,
  WorkbookDashboard,
  WorkbookModelSignal,
  WorkbookScoreSeries
} from "../shared/contracts.js";

type HistoryPeriod = "30D" | "90D" | "YTD" | "ALL";

const periods: HistoryPeriod[] = ["30D", "90D", "YTD", "ALL"];
const modelIds = ["mtpi", "ltpi", "nspi", "mrpi"];
const modelSections: Record<string, string> = {
  mtpi: "01 / Trend",
  ltpi: "02 / Trend",
  nspi: "03 / Regime",
  mrpi: "04 / Rates"
};
const modelPurposes: Record<string, string> = {
  mtpi: "Five-day trend model using total crypto market capitalization and TOTAL2.",
  ltpi: "Weekly trend model using the broad crypto market and Bitcoin.",
  nspi: "Measures the derived aggregate regime from the latest published MTPI and LTPI values.",
  mrpi: "Measures tightening versus easing pressure in the 10-year Treasury backdrop."
};
const methodologyLinks: Record<string, string> = {
  mtpi: "trend-following.html#medium-term-trend",
  ltpi: "ltpi-methodology.html",
  nspi: "methodology.html#liquidity-regime",
  mrpi: "mrpi-methodology.html"
};
const scaleThresholds = [-0.75, -0.25, 0.25, 0.75];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatScore(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function tone(signal: WorkbookModelSignal): "good" | "warn" | "bad" | "neutral" {
  if (signal.id === "mrpi") {
    if (signal.value <= -0.75) return "bad";
    if (signal.value < -0.25) return "warn";
    if (signal.value <= 0.25) return "neutral";
    return "good";
  }
  if (signal.value <= -0.75) return "bad";
  if (signal.value < -0.25) return "warn";
  if (signal.value <= 0.25) return "neutral";
  return "good";
}

function periodLabel(period: HistoryPeriod): string {
  return period === "ALL" ? "Full history" : period;
}

function filterPoints(points: MarketPoint[], period: HistoryPeriod): MarketPoint[] {
  const latest = points.at(-1);
  if (!latest || period === "ALL") return points;
  const start = new Date(latest.timestamp);
  if (period === "YTD") start.setUTCMonth(0, 1);
  else start.setUTCDate(start.getUTCDate() - (period === "30D" ? 30 : 90));
  return points.filter((point) => new Date(point.timestamp) >= start);
}

function defaultPeriod(points: MarketPoint[]): HistoryPeriod {
  return periods.find((period) => period !== "ALL" && filterPoints(points, period).length > 1) ?? "ALL";
}

function periodButtons(active: HistoryPeriod): string {
  return `<div class="history-range" aria-label="History range">
    <span>History</span>
    ${periods.map((period) => `<button type="button" data-model-history-period="${period}" class="${period === active ? "is-active" : ""}">${period === "ALL" ? "All" : period}</button>`).join("")}
  </div>`;
}

function renderChart(
  container: HTMLElement,
  points: MarketPoint[],
  chartId: string,
  thresholds: number[]
): void {
  if (points.length < 2) {
    container.innerHTML = "<span>Not enough verified observations in this window.</span>";
    container.classList.add("is-unavailable");
    return;
  }
  container.classList.remove("is-unavailable");
  const width = 760;
  const height = 236;
  const padding = { top: 22, right: 18, bottom: 34, left: 18 };
  const x = (index: number) => padding.left + (index / (points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((1 - value) / 2) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height - padding.bottom} L${x(0).toFixed(1)} ${height - padding.bottom} Z`;
  const gradientId = `model-history-fill-${chartId}`;
  const lastIndex = points.length - 1;
  const gridLines = [0.25, 0.5, 0.75].map((ratio) => {
    const gridY = padding.top + ratio * (height - padding.top - padding.bottom);
    return `<path d="M${padding.left} ${gridY}H${width - padding.right}" class="market-chart-gridline"/>`;
  }).join("");
  const thresholdPaths = thresholds
    .map((threshold) => `<path d="M${padding.left} ${y(threshold).toFixed(1)}H${width - padding.right}" class="market-chart-threshold"/>`)
    .join("");
  container.innerHTML = `
    <div class="terminal-chart-readout" data-model-chart-readout><time>${escapeHtml(formatDate(points[lastIndex]!.timestamp))}</time><strong>${formatScore(points[lastIndex]!.value)}</strong></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dated historical model chart">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc8f4" stop-opacity=".28"/><stop offset="1" stop-color="#8fc8f4" stop-opacity="0"/></linearGradient></defs>
      ${gridLines}
      ${thresholdPaths}
      <path d="${area}" fill="url(#${gradientId})"/>
      <path d="${line}" class="market-chart-line" pathLength="1"/>
      <line x1="${x(lastIndex)}" x2="${x(lastIndex)}" y1="${padding.top}" y2="${height - padding.bottom}" class="chart-hover-guide" data-model-chart-guide/>
      <circle cx="${x(lastIndex)}" cy="${y(points[lastIndex]!.value)}" r="5" class="market-chart-current" data-model-chart-dot/>
      <text x="${padding.left}" y="${height - 10}" class="market-chart-date">${escapeHtml(formatDate(points[0]!.timestamp))}</text>
      <text x="${width - padding.right}" y="${height - 10}" text-anchor="end" class="market-chart-date">${escapeHtml(formatDate(points[lastIndex]!.timestamp))}</text>
    </svg>`;

  const svg = container.querySelector<SVGElement>("svg")!;
  const guide = svg.querySelector<SVGLineElement>("[data-model-chart-guide]");
  const dot = svg.querySelector<SVGCircleElement>("[data-model-chart-dot]");
  const readout = container.querySelector<HTMLElement>("[data-model-chart-readout]");
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
    if (value) value.textContent = formatScore(point.value);
  };
  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    inspect(Math.round(ratio * lastIndex));
  });
  svg.addEventListener("pointerleave", () => inspect(lastIndex));
}

function formatUpdatedLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : formatDate(parsed.toISOString());
}

function sourceLabel(signal: WorkbookModelSignal, series: WorkbookScoreSeries | undefined): string {
  if (signal.source === "derived") return "Derived from MTPI + LTPI";
  return series?.sourceTab ?? signal.sourceTab ?? "Published model reading";
}

function classificationNote(signal: WorkbookModelSignal): string {
  if (signal.id === "mrpi") return "Five-band tightening versus easing scale.";
  return signal.regime === signal.state ? "Published regime label." : `Regime translation: ${signal.regime}.`;
}

function panelMarkup(signal: WorkbookModelSignal, series: WorkbookScoreSeries | undefined, period: HistoryPeriod): string {
  const latestDate = series?.points.at(-1)?.date;
  const updated = formatUpdatedLabel(signal.updatedLabel) ?? (latestDate ? formatDate(`${latestDate}T00:00:00.000Z`) : "Current published state");
  const classificationTone = tone(signal);
  const methodologyHref = methodologyLinks[signal.id] ?? "methodology.html";
  return `<article id="${escapeHtml(signal.id)}" class="aq-model-card" data-model-history-card="${escapeHtml(signal.id)}">
    <header class="aq-model-head">
      <div>
        <p class="aq-section-label">${escapeHtml(modelSections[signal.id] ?? "Model")}</p>
        <h3>${escapeHtml(signal.name)}</h3>
        <p>${escapeHtml(modelPurposes[signal.id] ?? signal.scope)}</p>
      </div>
      <div class="aq-model-actions">
        <a class="button" href="${escapeHtml(methodologyHref)}">Methodology</a>
        <a class="button" href="backtesting.html">Open Backtesting</a>
      </div>
    </header>
    <div class="aq-model-meta">
      <div class="aq-meta-box">
        <span>Current reading</span>
        <strong>${formatScore(signal.value)}</strong>
      </div>
      <div class="aq-meta-box">
        <span>Classification</span>
        <strong class="status-${classificationTone}">${escapeHtml(signal.state)}</strong>
        <p>${escapeHtml(classificationNote(signal))}</p>
      </div>
      <div class="aq-meta-box">
        <span>Updated</span>
        <strong>${escapeHtml(updated)}</strong>
        <p>${escapeHtml(sourceLabel(signal, series))}</p>
      </div>
    </div>
    <details class="aq-model-history-details">
      <summary><span>Dated history</span><strong>${series?.points.length ? `${series.points.length} observations` : "Unavailable"}</strong></summary>
      <div class="aq-model-chart-wrap">
        ${series?.points.length ? periodButtons(period) : ""}
        <div class="terminal-chart aq-chart-panel" data-model-history-chart="${escapeHtml(signal.id)}"><span>${escapeHtml(series?.message ?? "Historical series unavailable.")}</span></div>
        <div class="aq-chart-foot">
          <span data-model-history-range>${escapeHtml(series?.sourceTab ?? signal.sourceTab ?? "Historical range pending")}</span>
          <span>${escapeHtml(periodLabel(period))}</span>
        </div>
      </div>
    </details>
  </article>`;
}

export function renderModelHistory(dashboard: WorkbookDashboard): void {
  const root = document.querySelector<HTMLElement>("[data-model-history]");
  if (!root) return;
  const signalById = new Map(dashboard.signals.map((signal) => [signal.id, signal]));
  const seriesById = new Map(dashboard.scoreSeries.map((series) => [series.id, series]));
  const panels = modelIds.map((id) => ({ signal: signalById.get(id), series: seriesById.get(id as WorkbookScoreSeries["id"]) })).filter(
    (panel): panel is { signal: WorkbookModelSignal; series: WorkbookScoreSeries | undefined } => Boolean(panel.signal)
  );
  const selectedPeriods = new Map(panels.map(({ signal, series }) => {
    const points = (series?.points ?? []).map((point) => ({ timestamp: `${point.date}T00:00:00.000Z`, value: point.score }));
    return [signal.id, defaultPeriod(points)];
  }));
  root.innerHTML = panels.map(({ signal, series }) => panelMarkup(signal, series, selectedPeriods.get(signal.id)!)).join("");

  for (const { signal, series } of panels) {
    if (!series?.points.length) continue;
    const panel = root.querySelector<HTMLElement>(`[data-model-history-card="${signal.id}"]`)!;
    const allPoints = series.points.map((point) => ({ timestamp: `${point.date}T00:00:00.000Z`, value: point.score }));
    const render = () => {
      const period = selectedPeriods.get(signal.id)!;
      const points = filterPoints(allPoints, period);
      const chart = panel.querySelector<HTMLElement>(`[data-model-history-chart="${signal.id}"]`)!;
      renderChart(chart, points, `${signal.id}-${period}`, scaleThresholds);
      const range = panel.querySelector<HTMLElement>("[data-model-history-range]");
      if (range) range.textContent = points.length > 1
        ? `${formatDate(points[0]!.timestamp)} - ${formatDate(points.at(-1)!.timestamp)}`
        : series.message ?? sourceLabel(signal, series);
    };
    panel.querySelectorAll<HTMLButtonElement>("[data-model-history-period]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedPeriods.set(signal.id, button.dataset.modelHistoryPeriod as HistoryPeriod);
        panel.querySelectorAll<HTMLButtonElement>("[data-model-history-period]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        render();
      });
    });
    render();
  }

  const state = document.querySelector<HTMLElement>("[data-model-history-status]");
  if (state) {
    state.dataset.state = panels.some(({ series }) => series?.points.length) ? "ready" : "unavailable";
    const label = state.querySelector("span");
    if (label) label.textContent = panels.some(({ series }) => series?.points.length) ? "Dated history available" : "History unavailable";
  }
}

export function renderModelHistoryUnavailable(): void {
  const root = document.querySelector<HTMLElement>("[data-model-history]");
  if (root) root.innerHTML = '<p class="terminal-loading-copy">Model history is temporarily unavailable. No substitute series is shown.</p>';
  const state = document.querySelector<HTMLElement>("[data-model-history-status]");
  if (state) {
    state.dataset.state = "unavailable";
    const label = state.querySelector("span");
    if (label) label.textContent = "History unavailable";
  }
}
