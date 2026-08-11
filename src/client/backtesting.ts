import type {
  BitcoinValuationDashboard,
  WorkbookDashboard,
  WorkbookScorePoint,
  WorkbookScoreSeries,
  WorkbookTabCategory
} from "../shared/contracts.js";
import { analyzeScoreSeries, type BacktestRegime } from "../shared/backtesting.js";
import { apiRequest } from "./api.js";

const coreRegimeLabels: Record<BacktestRegime, string> = {
  risk_off: "Risk-off",
  neutral: "Neutral",
  risk_on: "Risk-on"
};

interface BacktestSeries {
  id: string;
  label: string;
  sourceTab: string;
  status: "ready" | "unavailable";
  message: string | null;
  points: WorkbookScorePoint[];
  extent: [number, number];
  defaultThresholds: [number, number];
  thresholdStep: number;
  regimeLabels: Record<BacktestRegime, string>;
  scoreSuffix: string;
}

const categoryLabels: Record<WorkbookTabCategory, string> = {
  allocation: "Allocation",
  relative_strength: "Relative strength",
  core_model: "Core model",
  forward_test: "Forward test",
  asset_model: "Asset model",
  breadth: "Breadth",
  selection: "Selection"
};

type BacktestPeriod = "30D" | "90D" | "YTD" | "ALL";

function formatScore(value: number | null, suffix = ""): string {
  if (value === null) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function formatDate(value: string | null): string {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function setText(selector: string, value: string): void {
  const node = document.querySelector<HTMLElement>(selector);
  if (node) node.textContent = value;
}

function coreSeries(series: WorkbookScoreSeries): BacktestSeries {
  return {
    ...series,
    extent: [-1, 1],
    defaultThresholds: [-0.25, 0.25],
    thresholdStep: 0.05,
    regimeLabels: coreRegimeLabels,
    scoreSuffix: ""
  };
}

function valuationSeries(dashboard: BitcoinValuationDashboard): BacktestSeries {
  return {
    id: "bitcoin-valuation",
    label: "Bitcoin Valuation",
    sourceTab: "BTC SDCA / Forward Testing",
    status: dashboard.history.length ? "ready" : "unavailable",
    message: dashboard.historyMessage,
    points: dashboard.history,
    extent: [dashboard.scaleMin, dashboard.scaleMax],
    defaultThresholds: [-0.5, 0.5],
    thresholdStep: 0.1,
    regimeLabels: { risk_off: "No value", neutral: "Neutral", risk_on: "High value" },
    scoreSuffix: "\u03c3"
  };
}

function windowSeries(series: BacktestSeries, period: BacktestPeriod): BacktestSeries {
  const latest = series.points.at(-1);
  if (!latest || period === "ALL") return series;
  const end = new Date(`${latest.date}T00:00:00Z`);
  const start = new Date(end);
  if (period === "YTD") start.setUTCMonth(0, 1);
  else start.setUTCDate(start.getUTCDate() - Number.parseInt(period, 10));
  const startDate = start.toISOString().slice(0, 10);
  return { ...series, points: series.points.filter((point) => point.date >= startDate) };
}

function chartMarkup(series: BacktestSeries, negativeThreshold: number, positiveThreshold: number): string {
  const points = series.points;
  if (points.length < 1) return "";
  const width = 1000;
  const height = 320;
  const paddingX = 28;
  const paddingY = 22;
  const [minimum, maximum] = series.extent;
  const span = maximum - minimum;
  const x = (index: number) => points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
  const y = (score: number) => paddingY + ((maximum - score) / span) * (height - paddingY * 2);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${y(minimum).toFixed(1)} L${x(0).toFixed(1)} ${y(minimum).toFixed(1)} Z`;
  const current = points.at(-1)!;
  const currentX = x(points.length - 1).toFixed(1);
  const currentY = y(current.score).toFixed(1);
  return `
    <defs><linearGradient id="backtest-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8caed3" stop-opacity=".32"/><stop offset="1" stop-color="#8caed3" stop-opacity="0"/></linearGradient></defs>
    <rect x="${paddingX}" y="${y(positiveThreshold).toFixed(1)}" width="${width - paddingX * 2}" height="${(y(negativeThreshold) - y(positiveThreshold)).toFixed(1)}" fill="rgba(185,181,174,.035)"/>
    <path d="M${paddingX} ${y(positiveThreshold).toFixed(1)} H${width - paddingX}" class="backtest-threshold"/>
    <path d="M${paddingX} ${y(negativeThreshold).toFixed(1)} H${width - paddingX}" class="backtest-threshold"/>
    <path d="M${paddingX} ${y(0).toFixed(1)} H${width - paddingX}" class="backtest-zero"/>
    ${points.length > 1 ? `<path d="${area}" fill="url(#backtest-area)"/><path d="${line}" class="backtest-line"/>` : `<circle cx="${currentX}" cy="${currentY}" r="15" class="backtest-current-halo"/>`}
    <line x1="${currentX}" x2="${currentX}" y1="${paddingY}" y2="${height - paddingY}" class="chart-hover-guide" data-backtest-guide/>
    <circle cx="${currentX}" cy="${currentY}" r="6" class="backtest-current" data-backtest-hover/>
  `;
}

function bindChartInspector(series: BacktestSeries): void {
  const chart = document.querySelector<SVGElement>("[data-backtest-chart]");
  const inspector = document.querySelector<HTMLElement>("[data-backtest-inspector]");
  if (!chart || !inspector || series.points.length < 1) return;
  const guide = chart.querySelector<SVGLineElement>("[data-backtest-guide]");
  const dot = chart.querySelector<SVGCircleElement>("[data-backtest-hover]");
  const time = inspector.querySelector("time");
  const value = inspector.querySelector("strong");

  const inspect = (index: number) => {
    const point = series.points[index]!;
    const [minimum, maximum] = series.extent;
    const x = series.points.length === 1 ? 500 : 28 + (index / (series.points.length - 1)) * 944;
    const y = 22 + ((maximum - point.score) / (maximum - minimum)) * 276;
    guide?.setAttribute("x1", x.toFixed(1));
    guide?.setAttribute("x2", x.toFixed(1));
    dot?.setAttribute("cx", x.toFixed(1));
    dot?.setAttribute("cy", y.toFixed(1));
    if (time) time.textContent = formatDate(point.date);
    if (value) value.textContent = formatScore(point.score, series.scoreSuffix);
    inspector.hidden = false;
  };

  inspect(series.points.length - 1);
  if (series.points.length === 1) return;
  chart.onpointermove = (event) => {
    const rect = chart.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    inspect(Math.round(ratio * (series.points.length - 1)));
  };
  chart.onpointerleave = () => inspect(series.points.length - 1);
}

function renderCoverage(dashboard: WorkbookDashboard): void {
  const root = document.querySelector<HTMLElement>("[data-workbook-tabs]");
  if (!root) return;
  root.innerHTML = dashboard.tabs.map((tab) => `
    <article class="workbook-tab ${tab.status === "ready" ? "is-ready" : ""}">
      <div><span>${escapeHtml(categoryLabels[tab.category])}</span><i>${tab.status === "ready" ? "Online" : "Offline"}</i></div>
      <h3>${escapeHtml(tab.name)}</h3>
      <p>${escapeHtml(tab.description)}</p>
      <footer>
        <span>${tab.rowCount ? `${tab.rowCount} populated rows` : "Waiting for connection"}</span>
        ${tab.latestScore === null ? "" : `<strong>${formatScore(tab.latestScore)} ${escapeHtml(tab.latestState ?? "")}</strong>`}
      </footer>
      ${tab.formulaErrorCount ? `<small>${tab.formulaErrorCount} formula error${tab.formulaErrorCount === 1 ? "" : "s"} excluded</small>` : ""}
    </article>
  `).join("");

  const ratioRoot = document.querySelector<HTMLElement>("[data-ratio-models]");
  if (ratioRoot) {
    ratioRoot.innerHTML = dashboard.ratioModels.length
      ? dashboard.ratioModels.map((model) => `<div><span>${escapeHtml(model.label)}</span><strong>${formatScore(model.score)}</strong><b>${escapeHtml(model.state)}</b><small>${escapeHtml(model.sourceTab)}</small></div>`).join("")
      : '<p class="backtest-empty-copy">Relative-strength summaries will appear when the research workbook feed is connected.</p>';
  }

  const warningRoot = document.querySelector<HTMLElement>("[data-workbook-warnings]");
  if (warningRoot) warningRoot.innerHTML = dashboard.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

function renderSeries(series: BacktestSeries, totalObservations: number, negativeThreshold: number, positiveThreshold: number): void {
  const analysis = analyzeScoreSeries(series.points, negativeThreshold, positiveThreshold);
  const chart = document.querySelector<SVGElement>("[data-backtest-chart]");
  const empty = document.querySelector<HTMLElement>("[data-backtest-empty]");
  if (chart) chart.innerHTML = chartMarkup(series, negativeThreshold, positiveThreshold);
  bindChartInspector(series);
  if (empty) {
    empty.hidden = analysis.observations > 0;
    empty.textContent = series.message ?? "No valid dated observations are available.";
  }

  setText("[data-kpi-observations]", String(analysis.observations));
  setText("[data-kpi-current]", formatScore(analysis.currentScore, series.scoreSuffix));
  setText("[data-kpi-latest-date]", formatDate(analysis.endDate));
  setText("[data-kpi-transitions]", String(analysis.transitions.length));
  setText("[data-kpi-streak]", analysis.currentRegime ? `${analysis.currentStreak} obs / ${series.regimeLabels[analysis.currentRegime]}` : "--");
  setText("[data-kpi-range]", analysis.startDate === analysis.endDate ? formatDate(analysis.startDate) : analysis.startDate ? `${formatDate(analysis.startDate)} - ${formatDate(analysis.endDate)}` : "--");
  setText("[data-series-source]", `${series.sourceTab} / ${analysis.observations} of ${totalObservations} dated observations${series.message ? ` / ${series.message}` : ""}`);

  const axis = document.querySelector<HTMLElement>("[data-backtest-axis]");
  if (axis) {
    const middle = series.points[Math.floor((series.points.length - 1) / 2)];
    axis.innerHTML = analysis.startDate && analysis.endDate
      ? series.points.length === 1
        ? `<span></span><span>${escapeHtml(formatDate(analysis.startDate))}</span><span></span>`
        : `<span>${escapeHtml(formatDate(analysis.startDate))}</span><span>${escapeHtml(formatDate(middle?.date ?? analysis.startDate))}</span><span>${escapeHtml(formatDate(analysis.endDate))}</span>`
      : "";
  }

  for (const regime of Object.keys(coreRegimeLabels) as BacktestRegime[]) {
    const count = analysis.counts[regime];
    const percentage = analysis.observations ? (count / analysis.observations) * 100 : 0;
    const row = document.querySelector<HTMLElement>(`[data-distribution="${regime}"]`);
    const bar = row?.querySelector<HTMLElement>("i");
    const value = row?.querySelector<HTMLElement>("strong");
    const label = row?.querySelector<HTMLElement>("span");
    if (bar) bar.style.width = `${percentage.toFixed(1)}%`;
    if (value) value.textContent = `${percentage.toFixed(0)}% / ${count}`;
    if (label) label.textContent = series.regimeLabels[regime];
  }

  const transitions = document.querySelector<HTMLElement>("[data-transition-list]");
  if (transitions) {
    transitions.innerHTML = analysis.transitions.length
      ? analysis.transitions.slice(-8).reverse().map((transition) => `
          <div><time>${escapeHtml(formatDate(transition.date))}</time><span>${series.regimeLabels[transition.from]} to ${series.regimeLabels[transition.to]}</span><strong>${formatScore(transition.score, series.scoreSuffix)}</strong></div>
        `).join("")
      : '<p class="backtest-empty-copy">No regime transitions under the selected thresholds.</p>';
  }


  const observations = document.querySelector<HTMLElement>("[data-observation-list]");
  if (observations) {
    observations.innerHTML = series.points.length
      ? [...series.points].reverse().map((point) => `
          <div><time datetime="${escapeHtml(point.date)}">${escapeHtml(formatDate(point.date))}</time><strong>${formatScore(point.score, series.scoreSuffix)}</strong></div>
        `).join("")
      : '<p class="backtest-empty-copy">No dated observations in this history window.</p>';
  }
}

export async function bootBacktesting(): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-backtest-status]");
  const seriesSelect = document.querySelector<HTMLSelectElement>("[data-series-select]");
  const negativeInput = document.querySelector<HTMLInputElement>("[data-negative-threshold]");
  const positiveInput = document.querySelector<HTMLInputElement>("[data-positive-threshold]");
  if (!seriesSelect || !negativeInput || !positiveInput) return;

  const [workbookResult, valuationResult] = await Promise.allSettled([
    apiRequest<WorkbookDashboard>("/api/workbook", { signal: AbortSignal.timeout(15_000) }),
    apiRequest<BitcoinValuationDashboard>("/api/valuation", { signal: AbortSignal.timeout(15_000) })
  ]);

  const series: BacktestSeries[] = [];
  if (valuationResult.status === "fulfilled") series.push(valuationSeries(valuationResult.value));
  if (workbookResult.status === "fulfilled") {
    const dashboard = workbookResult.value;
    renderCoverage(dashboard);
    series.push(...dashboard.scoreSeries.map(coreSeries));
  }

  if (!series.length) {
    if (state) {
      state.dataset.state = "unavailable";
      state.querySelector("span")!.textContent = "Research APIs unavailable";
    }
    setText("[data-backtest-empty]", "The research APIs could not be reached. No historical output has been substituted.");
    return;
  }

  if (state) {
    const workbookLive = workbookResult.status === "fulfilled" && (workbookResult.value.status === "ready" || workbookResult.value.status === "partial");
    const valuationLive = valuationResult.status === "fulfilled" && valuationResult.value.status !== "unavailable";
    state.dataset.state = workbookLive || valuationLive ? "ready" : "unavailable";
    state.querySelector("span")!.textContent = workbookLive && valuationLive
      ? "Model and valuation feeds live"
      : valuationLive
        ? "Valuation feed live"
        : workbookLive
          ? "Model feed live"
          : "Research feeds unavailable";
  }

  seriesSelect.innerHTML = series.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.label)}</option>`).join("");
  const mtpi = series.find((candidate) => candidate.id === "mtpi" && candidate.status === "ready");
  const valuation = series.find((candidate) => candidate.id === "bitcoin-valuation" && candidate.points.length > 0);
  const nspi = series.find((candidate) => candidate.id === "nspi" && candidate.status === "ready");
  seriesSelect.value = (mtpi ?? valuation ?? nspi ?? series[0])!.id;

  let period: BacktestPeriod = "90D";
  const thresholds = new Map(series.map((candidate) => [candidate.id, candidate.defaultThresholds]));
  const selectedSeries = () => series.find((candidate) => candidate.id === seriesSelect.value) ?? series[0]!;
  const syncControls = () => {
    const active = selectedSeries();
    const [minimum, maximum] = active.extent;
    const [negative, positive] = thresholds.get(active.id) ?? active.defaultThresholds;
    negativeInput.min = String(minimum);
    negativeInput.max = "0";
    negativeInput.step = String(active.thresholdStep);
    negativeInput.value = String(negative);
    positiveInput.min = "0";
    positiveInput.max = String(maximum);
    positiveInput.step = String(active.thresholdStep);
    positiveInput.value = String(positive);
    setText("[data-negative-threshold-label]", `${active.regimeLabels.risk_off} below`);
    setText("[data-positive-threshold-label]", `${active.regimeLabels.risk_on} above`);
  };
  const rerender = () => {
    const fullSeries = selectedSeries();
    const negative = Number(negativeInput.value);
    const positive = Number(positiveInput.value);
    thresholds.set(fullSeries.id, [negative, positive]);
    setText("[data-negative-value]", formatScore(negative, fullSeries.scoreSuffix));
    setText("[data-positive-value]", formatScore(positive, fullSeries.scoreSuffix));
    const visibleSeries = windowSeries(fullSeries, period);
    if (negative < positive) renderSeries(visibleSeries, fullSeries.points.length, negative, positive);
  };
  seriesSelect.addEventListener("change", () => {
    syncControls();
    rerender();
  });
  negativeInput.addEventListener("input", rerender);
  positiveInput.addEventListener("input", rerender);
  document.querySelectorAll<HTMLButtonElement>("[data-backtest-period]").forEach((button) => {
    button.addEventListener("click", () => {
      period = button.dataset.backtestPeriod as BacktestPeriod;
      document.querySelectorAll<HTMLButtonElement>("[data-backtest-period]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      rerender();
    });
  });
  syncControls();
  rerender();
}
