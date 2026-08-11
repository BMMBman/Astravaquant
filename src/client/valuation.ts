import type {
  BitcoinValuationDashboard,
  MarketDashboard,
  MarketMetric,
  ValuationCategoryId,
  ValuationIndicator,
  ValuationPoint
} from "../shared/contracts.js";
import { apiRequest } from "./api.js";

const categoryColors: Record<ValuationCategoryId, string> = {
  fundamental: "#8fc8f4",
  technical: "#e7c68d",
  sentiment: "#b5c6d8"
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]!);
}

function formatScore(value: number | null, suffix = "σ"): string {
  if (value === null) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatPrice(metric: MarketMetric): string {
  if (metric.value === null) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: metric.value >= 1_000 ? 0 : 2
  }).format(metric.value);
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function scorePosition(value: number, minimum: number, maximum: number): number {
  const clamped = Math.min(maximum, Math.max(minimum, value));
  return ((clamped - minimum) / (maximum - minimum)) * 100;
}

function renderSummary(dashboard: BitcoinValuationDashboard): void {
  setText("[data-valuation-score]", formatScore(dashboard.score));
  setText("[data-valuation-state]", dashboard.state?.toUpperCase() ?? "UNAVAILABLE");
  setText("[data-indicator-count]", String(dashboard.indicatorCount || "--"));
  setText("[data-valuation-date]", formatDate(dashboard.workbookUpdatedLabel));
  setText("[data-inverse-score]", formatScore(dashboard.invertedScore));
  setText("[data-inverse-state]", dashboard.invertedState?.toUpperCase() ?? "Unavailable");
  setText("[data-valuation-status]", dashboard.status === "ready" ? "Live workbook" : dashboard.status === "partial" ? "Partial workbook" : "Feed unavailable");

  const status = document.querySelector<HTMLElement>("[data-valuation-status]");
  status?.classList.toggle("is-unavailable", dashboard.status === "unavailable");

  const source = document.querySelector<HTMLAnchorElement>("[data-valuation-source]");
  if (source) source.href = dashboard.sourceUrl;

  const marker = document.querySelector<HTMLElement>("[data-valuation-marker]");
  if (marker && dashboard.score !== null) {
    const position = `${scorePosition(dashboard.score, dashboard.scaleMin, dashboard.scaleMax).toFixed(2)}%`;
    marker.style.setProperty("--valuation-position", "50%");
    requestAnimationFrame(() => requestAnimationFrame(() => marker.style.setProperty("--valuation-position", position)));
    setText("[data-marker-label]", formatScore(dashboard.score));
  }
}

function renderCategories(dashboard: BitcoinValuationDashboard): void {
  const root = document.querySelector<HTMLElement>("[data-valuation-categories]");
  if (!root) return;
  if (!dashboard.categories.length) {
    root.innerHTML = '<article class="valuation-category-card glass-card"><span>Workbook</span><strong>Unavailable</strong><small>Try again shortly</small></article>';
    return;
  }
  root.innerHTML = dashboard.categories.map((category) => `
    <article class="valuation-category-card glass-card" style="--category-color:${categoryColors[category.id]}">
      <span>${escapeHtml(category.label)}</span>
      <strong>${escapeHtml(formatScore(category.averageScore))}</strong>
      <small>${category.indicatorCount} verified input${category.indicatorCount === 1 ? "" : "s"}</small>
      <div class="valuation-category-line"><i style="width:${scorePosition(category.averageScore, -3, 3).toFixed(2)}%"></i></div>
    </article>
  `).join("");
}

function renderInputs(indicators: ValuationIndicator[], category: ValuationCategoryId): void {
  const root = document.querySelector<HTMLElement>("[data-valuation-inputs]");
  if (!root) return;
  const filtered = indicators.filter((indicator) => indicator.category === category);
  if (!filtered.length) {
    root.innerHTML = '<p class="valuation-empty-copy">No verified inputs are available for this category.</p>';
    return;
  }
  root.innerHTML = filtered.map((indicator, index) => `
    <article class="valuation-input-row">
      <span class="valuation-input-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="valuation-input-copy">
        <h3>${escapeHtml(indicator.name)}</h3>
        ${indicator.description ? `<p>${escapeHtml(indicator.description)}</p>` : ""}
      </div>
      <div class="valuation-input-reading">
        <strong>${escapeHtml(formatScore(indicator.score))}</strong>
        <span>${escapeHtml(indicator.state)}</span>
      </div>
      <div class="valuation-input-rail" aria-hidden="true"><i style="left:${scorePosition(indicator.score, -3, 3).toFixed(2)}%"></i></div>
      ${indicator.sourceUrl ? `<a class="valuation-source-link" href="${escapeHtml(indicator.sourceUrl)}" target="_blank" rel="noreferrer" aria-label="Open source for ${escapeHtml(indicator.name)}">Source</a>` : '<span class="valuation-source-link is-muted">Internal</span>'}
    </article>
  `).join("");
}

function renderDispersion(indicators: ValuationIndicator[]): void {
  const root = document.querySelector<HTMLElement>("[data-dispersion-plot]");
  if (!root) return;
  if (!indicators.length) {
    root.innerHTML = "<p>Input dispersion is unavailable while the workbook feed is offline.</p>";
    return;
  }
  const lanes = (Object.keys(categoryColors) as ValuationCategoryId[]).map((category) => {
    const categoryIndicators = indicators.filter((indicator) => indicator.category === category);
    const dots = categoryIndicators.map((indicator, index) => {
      const x = scorePosition(indicator.score, -3, 3);
      const y = 28 + (index % 3) * 12;
      return `<button type="button" class="valuation-dot" style="left:${x.toFixed(2)}%;top:${y}px;--dot-color:${categoryColors[category]}" aria-label="${escapeHtml(indicator.name)}, ${escapeHtml(formatScore(indicator.score))}" title="${escapeHtml(indicator.name)}: ${escapeHtml(formatScore(indicator.score))}"></button>`;
    }).join("");
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    return `<div class="valuation-dot-lane"><span>${label}</span><div>${dots}</div></div>`;
  }).join("");
  root.innerHTML = `<div class="valuation-dot-axis"><span>-3σ</span><span>0</span><span>+3σ</span></div>${lanes}`;
}

function renderHistoryChart(root: HTMLElement, points: ValuationPoint[]): void {
  const width = 680;
  const height = 220;
  const padding = { top: 24, right: 20, bottom: 32, left: 20 };
  const values = points.map((point) => point.score);
  const minimum = Math.min(-2, ...values);
  const maximum = Math.max(2, ...values);
  const span = maximum - minimum || 1;
  const x = (index: number) => padding.left + (index / (points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((maximum - value) / span) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height - padding.bottom} L${x(0).toFixed(1)} ${height - padding.bottom} Z`;
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bitcoin valuation forward-test history">
    <defs><linearGradient id="valuation-history-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc8f4" stop-opacity=".3"/><stop offset="1" stop-color="#8fc8f4" stop-opacity="0"/></linearGradient></defs>
    <path d="M${padding.left} ${y(0)}H${width - padding.right}" class="valuation-history-zero"/>
    <path d="${area}" fill="url(#valuation-history-fill)"/>
    <path d="${line}" class="valuation-history-line" pathLength="1"/>
    <circle cx="${x(points.length - 1)}" cy="${y(points.at(-1)!.score)}" r="5" class="valuation-history-current"/>
    <text x="${padding.left}" y="${height - 8}" class="valuation-history-date">${escapeHtml(formatDate(points[0]!.date))}</text>
    <text x="${width - padding.right}" y="${height - 8}" text-anchor="end" class="valuation-history-date">${escapeHtml(formatDate(points.at(-1)!.date))}</text>
  </svg>`;
}

function renderHistory(dashboard: BitcoinValuationDashboard): void {
  const root = document.querySelector<HTMLElement>("[data-valuation-history]");
  const state = document.querySelector<HTMLElement>("[data-history-state]");
  if (!root) return;
  if (dashboard.historyStatus === "ready" && dashboard.history.length >= 2) {
    if (state) state.textContent = `${dashboard.history.length} observations`;
    renderHistoryChart(root, dashboard.history);
    return;
  }
  if (state) state.textContent = "Awaiting dates";
  root.classList.add("is-empty");
  root.innerHTML = `<div class="valuation-empty-state"><span>NO SERIES</span><h3>History starts with the first dated test.</h3><p>${escapeHtml(dashboard.historyMessage ?? "No verified dated history is published yet.")}</p></div>`;
}

function renderUnavailable(): void {
  setText("[data-valuation-status]", "Feed unavailable");
  const instrument = document.querySelector<HTMLElement>("[data-valuation-instrument]");
  instrument?.classList.add("is-unavailable");
  const root = document.querySelector<HTMLElement>("[data-valuation-inputs]");
  if (root) root.innerHTML = '<p class="valuation-empty-copy">The valuation workbook could not be reached. No score has been substituted.</p>';
}

function renderMarket(dashboard: MarketDashboard): void {
  const bitcoin = dashboard.metrics.find((metric) => metric.id === "bitcoin");
  if (!bitcoin || bitcoin.status !== "ready") return;
  setText("[data-bitcoin-price]", formatPrice(bitcoin));
  const change = bitcoin.change;
  setText("[data-bitcoin-change]", change === null ? "24h change unavailable" : `${change > 0 ? "+" : ""}${change.toFixed(2)}% · 24h`);
  const changeElement = document.querySelector<HTMLElement>("[data-bitcoin-change]");
  changeElement?.setAttribute("data-tone", change !== null && change < 0 ? "negative" : "positive");
}

export async function bootValuation(): Promise<void> {
  let activeCategory: ValuationCategoryId = "fundamental";
  let dashboard: BitcoinValuationDashboard | null = null;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-valuation-tab]")];

  buttons.forEach((button) => button.addEventListener("click", () => {
    activeCategory = button.dataset.valuationTab as ValuationCategoryId;
    buttons.forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
    if (dashboard) renderInputs(dashboard.indicators, activeCategory);
  }));

  const [valuationResult, marketResult] = await Promise.allSettled([
    apiRequest<BitcoinValuationDashboard>("/api/valuation", { signal: AbortSignal.timeout(12_000) }),
    apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(12_000) })
  ]);

  if (valuationResult.status === "fulfilled") {
    dashboard = valuationResult.value;
    if (dashboard.status === "unavailable") renderUnavailable();
    else {
      renderSummary(dashboard);
      renderCategories(dashboard);
      renderInputs(dashboard.indicators, activeCategory);
      renderDispersion(dashboard.indicators);
      renderHistory(dashboard);
    }
  } else {
    renderUnavailable();
  }

  if (marketResult.status === "fulfilled") renderMarket(marketResult.value);
  else {
    setText("[data-bitcoin-price]", "Unavailable");
    setText("[data-bitcoin-change]", "Market feed offline");
  }
}
