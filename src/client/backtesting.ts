import type { WorkbookDashboard, WorkbookScoreSeries, WorkbookTabCategory } from "../shared/contracts.js";
import { analyzeScoreSeries, type BacktestRegime } from "../shared/backtesting.js";
import { apiRequest } from "./api.js";

const regimeLabels: Record<BacktestRegime, string> = {
  risk_off: "Risk-off",
  neutral: "Neutral",
  risk_on: "Risk-on"
};

const categoryLabels: Record<WorkbookTabCategory, string> = {
  allocation: "Allocation",
  relative_strength: "Relative strength",
  core_model: "Core model",
  forward_test: "Forward test",
  asset_model: "Asset model",
  breadth: "Breadth",
  selection: "Selection"
};

function formatScore(value: number | null): string {
  if (value === null) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
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

function chartMarkup(series: WorkbookScoreSeries, negativeThreshold: number, positiveThreshold: number): string {
  const points = series.points;
  if (points.length < 2) return "";
  const width = 1000;
  const height = 320;
  const paddingX = 28;
  const paddingY = 22;
  const x = (index: number) => paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
  const y = (score: number) => paddingY + ((1 - score) / 2) * (height - paddingY * 2);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${y(-1).toFixed(1)} L${x(0).toFixed(1)} ${y(-1).toFixed(1)} Z`;
  const current = points.at(-1)!;
  return `
    <defs><linearGradient id="backtest-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8caed3" stop-opacity=".32"/><stop offset="1" stop-color="#8caed3" stop-opacity="0"/></linearGradient></defs>
    <rect x="${paddingX}" y="${y(positiveThreshold).toFixed(1)}" width="${width - paddingX * 2}" height="${(y(negativeThreshold) - y(positiveThreshold)).toFixed(1)}" fill="rgba(185,181,174,.035)"/>
    <path d="M${paddingX} ${y(positiveThreshold).toFixed(1)} H${width - paddingX}" class="backtest-threshold"/>
    <path d="M${paddingX} ${y(negativeThreshold).toFixed(1)} H${width - paddingX}" class="backtest-threshold"/>
    <path d="M${paddingX} ${y(0).toFixed(1)} H${width - paddingX}" class="backtest-zero"/>
    <path d="${area}" fill="url(#backtest-area)"/>
    <path d="${line}" class="backtest-line"/>
    <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(current.score).toFixed(1)}" r="6" class="backtest-current"/>
  `;
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

function renderSeries(series: WorkbookScoreSeries, negativeThreshold: number, positiveThreshold: number): void {
  const analysis = analyzeScoreSeries(series.points, negativeThreshold, positiveThreshold);
  const chart = document.querySelector<SVGElement>("[data-backtest-chart]");
  const empty = document.querySelector<HTMLElement>("[data-backtest-empty]");
  if (chart) chart.innerHTML = chartMarkup(series, negativeThreshold, positiveThreshold);
  if (empty) {
    empty.hidden = analysis.observations > 1;
    empty.textContent = series.message ?? "At least two valid observations are required.";
  }

  setText("[data-kpi-observations]", String(analysis.observations));
  setText("[data-kpi-current]", formatScore(analysis.currentScore));
  setText("[data-kpi-average]", formatScore(analysis.averageScore));
  setText("[data-kpi-transitions]", String(analysis.transitions.length));
  setText("[data-kpi-streak]", analysis.currentRegime ? `${analysis.currentStreak} obs / ${regimeLabels[analysis.currentRegime]}` : "--");
  setText("[data-kpi-range]", analysis.startDate ? `${formatDate(analysis.startDate)} - ${formatDate(analysis.endDate)}` : "--");
  setText("[data-series-source]", `${series.sourceTab} / ${analysis.observations} verified observations`);

  for (const regime of Object.keys(regimeLabels) as BacktestRegime[]) {
    const count = analysis.counts[regime];
    const percentage = analysis.observations ? (count / analysis.observations) * 100 : 0;
    const row = document.querySelector<HTMLElement>(`[data-distribution="${regime}"]`);
    const bar = row?.querySelector<HTMLElement>("i");
    const value = row?.querySelector<HTMLElement>("strong");
    if (bar) bar.style.width = `${percentage.toFixed(1)}%`;
    if (value) value.textContent = `${percentage.toFixed(0)}% / ${count}`;
  }

  const transitions = document.querySelector<HTMLElement>("[data-transition-list]");
  if (transitions) {
    transitions.innerHTML = analysis.transitions.length
      ? analysis.transitions.slice(-8).reverse().map((transition) => `
          <div><time>${escapeHtml(formatDate(transition.date))}</time><span>${regimeLabels[transition.from]} to ${regimeLabels[transition.to]}</span><strong>${formatScore(transition.score)}</strong></div>
        `).join("")
      : '<p class="backtest-empty-copy">No regime transitions under the selected thresholds.</p>';
  }
}

export async function bootBacktesting(): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-backtest-status]");
  const seriesSelect = document.querySelector<HTMLSelectElement>("[data-series-select]");
  const negativeInput = document.querySelector<HTMLInputElement>("[data-negative-threshold]");
  const positiveInput = document.querySelector<HTMLInputElement>("[data-positive-threshold]");
  if (!seriesSelect || !negativeInput || !positiveInput) return;

  try {
    const dashboard = await apiRequest<WorkbookDashboard>("/api/workbook");
    renderCoverage(dashboard);
    if (state) {
      state.dataset.state = dashboard.status === "ready" || dashboard.status === "partial" ? "ready" : "unavailable";
      state.querySelector("span")!.textContent = dashboard.status === "ready"
        ? "Research workbook live"
        : dashboard.status === "partial"
          ? "Workbook live / partial"
          : "Workbook connection pending";
    }

    seriesSelect.innerHTML = dashboard.scoreSeries.map((series) => `<option value="${series.id}">${escapeHtml(series.label)}</option>`).join("");
    const rerender = () => {
      const negative = Number(negativeInput.value);
      const positive = Number(positiveInput.value);
      setText("[data-negative-value]", negative.toFixed(2));
      setText("[data-positive-value]", `+${positive.toFixed(2)}`);
      const series = dashboard.scoreSeries.find((candidate) => candidate.id === seriesSelect.value) ?? dashboard.scoreSeries[0];
      if (series && negative < positive) renderSeries(series, negative, positive);
    };
    seriesSelect.addEventListener("change", rerender);
    negativeInput.addEventListener("input", rerender);
    positiveInput.addEventListener("input", rerender);
    rerender();
  } catch {
    if (state) {
      state.dataset.state = "unavailable";
      state.querySelector("span")!.textContent = "Research API unavailable";
    }
    setText("[data-backtest-empty]", "The research API could not be reached. No historical output has been substituted.");
  }
}
