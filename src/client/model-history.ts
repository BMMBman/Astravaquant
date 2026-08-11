import type {
  MarketPoint,
  WorkbookDashboard,
  WorkbookModelSignal,
  WorkbookScoreSeries
} from "../shared/contracts.js";

type HistoryPeriod = "30D" | "90D" | "YTD" | "ALL";

const periods: HistoryPeriod[] = ["30D", "90D", "YTD", "ALL"];
const modelIds = ["mtpi", "ltpi", "nspi", "mrpi"];
const modelScopes: Record<string, string> = {
  mtpi: "Five-day crypto trend",
  ltpi: "Weekly crypto trend",
  nspi: "Combined crypto regime",
  mrpi: "10-year Treasury pressure"
};

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
  return `<div class="history-range terminal-history-range" aria-label="History range">
    <span>History</span>
    ${periods.map((period) => `<button type="button" data-model-history-period="${period}" class="${period === active ? "is-active" : ""}">${period === "ALL" ? "All" : period}</button>`).join("")}
  </div>`;
}

function renderChart(
  container: HTMLElement,
  points: MarketPoint[],
  chartId: string,
  thresholds: [number, number]
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
  container.innerHTML = `
    <div class="terminal-chart-readout" data-model-chart-readout><time>${escapeHtml(formatDate(points[lastIndex]!.timestamp))}</time><strong>${formatScore(points[lastIndex]!.value)}</strong></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dated historical model chart">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc8f4" stop-opacity=".28"/><stop offset="1" stop-color="#8fc8f4" stop-opacity="0"/></linearGradient></defs>
      ${gridLines}
      <path d="M${padding.left} ${y(thresholds[1])}H${width - padding.right} M${padding.left} ${y(thresholds[0])}H${width - padding.right}" class="market-chart-threshold"/>
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

function panelMarkup(signal: WorkbookModelSignal, series: WorkbookScoreSeries | undefined, period: HistoryPeriod): string {
  const position = ((signal.value + 1) / 2) * 100;
  const isMrpi = signal.id === "mrpi";
  const latestDate = series?.points.at(-1)?.date;
  const asOf = latestDate ? `As of ${formatDate(`${latestDate}T00:00:00.000Z`)}` : signal.updatedLabel ?? "Current published state";
  return `<article class="terminal-model-card" data-model-history-card="${escapeHtml(signal.id)}">
    <header><div><span>${escapeHtml(modelScopes[signal.id] ?? signal.scope)}</span><h3>${escapeHtml(signal.name)}</h3></div><time>${escapeHtml(asOf)}</time></header>
    <div class="model-gauge-read"><strong>${formatScore(signal.value)}</strong><b>${escapeHtml(signal.regime)}</b></div>
    <div class="model-scale-gauge" aria-label="${escapeHtml(signal.name)} score ${formatScore(signal.value)}">
      <div><i></i><i></i><i></i><i></i><i></i><b style="left:${Math.min(100, Math.max(0, position)).toFixed(1)}%"></b></div>
      <small><span>${isMrpi ? "Tightening" : "Risk-off"} / -1</span><span>Neutral / 0</span><span>${isMrpi ? "Easing" : "Risk-on"} / +1</span></small>
    </div>
    ${series?.points.length ? periodButtons(period) : ""}
    <div class="terminal-chart terminal-model-chart" data-model-history-chart="${escapeHtml(signal.id)}"><span>${escapeHtml(series?.message ?? (isMrpi ? "MRPI history is temporarily unavailable." : "Historical series unavailable."))}</span></div>
    <footer><span data-model-history-range>${escapeHtml(series?.sourceTab ?? signal.sourceTab ?? "Published model reading")}</span><a href="backtesting.html">Open full backtest</a></footer>
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
      renderChart(chart, points, `${signal.id}-${period}`, signal.id === "mrpi" ? [-0.1, 0.1] : [-0.25, 0.25]);
      const range = panel.querySelector<HTMLElement>("[data-model-history-range]");
      if (range) range.textContent = points.length > 1
        ? `${formatDate(points[0]!.timestamp)} - ${formatDate(points.at(-1)!.timestamp)}`
        : series.message ?? series.sourceTab;
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
    if (label) label.textContent = panels.some(({ series }) => series?.points.length) ? "Verified history live" : "History unavailable";
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
