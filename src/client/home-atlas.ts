import type { BitcoinValuationDashboard, MarketDashboard, MarketMetric, WorkbookDashboard, WorkbookScoreSeries } from "../shared/contracts.js";
import { analyzeScoreSeries } from "../shared/backtesting.js";
import { apiRequest } from "./api.js";

type AtlasPanel = "trend" | "valuation" | "liquidity" | "backtesting";

const panelLabels: Record<AtlasPanel, string> = {
  trend: "Trend Following",
  valuation: "Bitcoin Valuation",
  liquidity: "Net Fed Liquidity",
  backtesting: "Forward-Test Diagnostics"
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function score(value: number | null, suffix = ""): string {
  return value === null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function date(value: string | null | undefined): string {
  if (!value) return "Unpublished";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function billions(value: number | null, valueIsBillions = false): string {
  if (value === null) return "--";
  const inBillions = valueIsBillions ? value : value / 1_000;
  return `$${inBillions.toLocaleString("en-US", { maximumFractionDigits: 0 })}B`;
}

function sparkline(points: Array<{ date: string; score: number }>): string {
  if (points.length < 2) return '<div class="aq-atlas-sparkline is-unavailable">History unavailable</div>';
  const width = 300;
  const height = 74;
  const values = points.map((point) => point.score);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const line = points.map((point, index) => {
    const x = 4 + index / (points.length - 1) * (width - 8);
    const y = 5 + (max - point.score) / span * (height - 10);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return `<div class="aq-atlas-sparkline"><svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${line}"/></svg></div>`;
}

function signalCard(series: WorkbookScoreSeries | undefined, label: string, state: string, updated: string | null | undefined): string {
  const latest = series?.points.at(-1) ?? null;
  return `<article class="aq-atlas-card">
    <p>${escapeHtml(label)}</p><strong>${score(latest?.score ?? null)}</strong><b>${escapeHtml(state)}</b>
    ${sparkline(series?.points ?? [])}
    <small>${latest ? `${date(latest.date)} / ${series?.points.length ?? 0} dated observations` : `Published ${date(updated)}`}</small>
  </article>`;
}

function trendMarkup(workbook: WorkbookDashboard): string {
  const signals = new Map(workbook.signals.map((signal) => [signal.id, signal]));
  const series = new Map(workbook.scoreSeries.map((item) => [item.id, item]));
  const medium = signals.get("mtpi");
  const long = signals.get("ltpi");
  return `<div class="aq-atlas-intro"><span>Two horizons, one research family</span><p>The five-day and weekly probability modules are published with their dated forward-test records.</p></div>
    <div class="aq-atlas-grid two">${signalCard(series.get("mtpi"), "Medium-Term Trend / MTTPM", medium?.state ?? "Unavailable", medium?.updatedLabel)}${signalCard(series.get("ltpi"), "Long-Term Trend / LTTPM", long?.state ?? "Unavailable", long?.updatedLabel)}</div>
    <div class="aq-atlas-foot"><a href="models.html#mtpi">Open full trend models</a><a href="backtesting.html">Inspect forward testing</a></div>`;
}

function valuationMarkup(valuation: BitcoinValuationDashboard): string {
  const categories = valuation.categories.map((category) => `<div><span>${escapeHtml(category.label)}</span><strong>${score(category.averageScore, "σ")}</strong><small>${category.indicatorCount} inputs</small></div>`).join("");
  return `<div class="aq-atlas-score"><span>Current Z-score</span><strong>${score(valuation.score, "σ")}</strong><b>${escapeHtml(valuation.state ?? "Unavailable")}</b><small>Published ${date(valuation.workbookUpdatedLabel)}</small></div>
    ${sparkline(valuation.history)}
    <div class="aq-atlas-categories">${categories || '<span>Category inputs unavailable</span>'}</div>
    <div class="aq-atlas-foot"><a href="valuation.html">Open valuation model</a><a href="valuation-methodology.html">Read methodology</a></div>`;
}

const liquidityComponents: Array<{ id: MarketMetric["id"]; code: string; label: string; subtract?: boolean }> = [
  { id: "fedLiquidity", code: "WALCL", label: "Fed assets" },
  { id: "treasuryGeneralAccount", code: "TGA", label: "Treasury account", subtract: true },
  { id: "reverseRepo", code: "RRPONTSYD", label: "Reverse repo", subtract: true },
  { id: "bankTermFundingProgram", code: "H41RESPPALDKNWW", label: "BTFP" },
  { id: "primaryCredit", code: "WLCFLPCL", label: "Primary credit" }
];

function liquidityMarkup(markets: MarketDashboard): string {
  const net = markets.metrics.find((metric) => metric.id === "fedNetLiquidity");
  const components = liquidityComponents.map((component) => {
    const metric = markets.metrics.find((candidate) => candidate.id === component.id);
    return `<div><code>${component.code}</code><span>${component.label}</span><strong>${billions(metric?.value ?? null, metric?.unit === "usd_billions")}</strong><b>${component.subtract ? "Subtract" : "Add"}</b></div>`;
  }).join("");
  return `<div class="aq-atlas-score"><span>Derived net liquidity</span><strong>${billions(net?.value ?? null)}</strong><b>${net?.status === "ready" ? "FRED-derived weekly series" : "Feed unavailable"}</b><small>${net?.asOf ? `As of ${date(net.asOf)}` : "No substitute reading"}</small></div>
    <div class="aq-atlas-formula"><span>WALCL - TGA - RRPONTSYD + H41RESPPALDKNWW + WLCFLPCL</span><small>All inputs aligned in millions of U.S. dollars.</small></div>
    <div class="aq-atlas-components">${components}</div>
    <div class="aq-atlas-foot"><a href="models.html#net-fed-liquidity">Open component charts</a></div>`;
}

function diagnosticsCard(series: WorkbookScoreSeries): string {
  const analysis = analyzeScoreSeries(series.points);
  const current = analysis.currentRegime === "risk_on" ? "Risk-on" : analysis.currentRegime === "risk_off" ? "Risk-off" : "Neutral";
  return `<article class="aq-atlas-card"><p>${escapeHtml(series.label)}</p><strong>${analysis.observations}</strong><b>${current}</b>${sparkline(series.points)}<small>${analysis.transitions.length} transitions / ${analysis.currentStreak} observation current streak</small></article>`;
}

function backtestingMarkup(workbook: WorkbookDashboard): string {
  const series = workbook.scoreSeries.filter((item) => item.id === "mtpi" || item.id === "ltpi");
  return `<div class="aq-atlas-intro"><span>Forward-testing diagnostics</span><p>Counts and transitions describe the published score history. They are not performance claims.</p></div>
    <div class="aq-atlas-grid two">${series.length ? series.map(diagnosticsCard).join("") : '<p class="aq-atlas-empty">Dated trend observations are unavailable.</p>'}</div>
    <div class="aq-atlas-foot"><a href="backtesting.html">Open complete backtesting</a></div>`;
}

export function bootHomeAtlas(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-atlas-dialog]");
  const title = document.querySelector<HTMLElement>("[data-atlas-title]");
  const content = document.querySelector<HTMLElement>("[data-atlas-content]");
  if (!dialog || !title || !content) return;

  let selectionVersion = 0;
  const open = async (panel: AtlasPanel) => {
    const requestVersion = ++selectionVersion;
    title.textContent = panelLabels[panel];
    content.innerHTML = '<div class="aq-atlas-loading"><i></i><span>Retrieving published research</span></div>';
    document.querySelectorAll<HTMLElement>("[data-atlas-open]").forEach((button) => button.classList.toggle("is-active", button.dataset.atlasOpen === panel));
    if (!dialog.open) dialog.showModal();
    try {
      let markup: string;
      if (panel === "valuation") {
        const valuation = await apiRequest<BitcoinValuationDashboard>("/api/valuation", { signal: AbortSignal.timeout(12_000) });
        markup = valuationMarkup(valuation);
      } else if (panel === "liquidity") {
        const markets = await apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(12_000) });
        markup = liquidityMarkup(markets);
      } else {
        const workbook = await apiRequest<WorkbookDashboard>("/api/workbook", { signal: AbortSignal.timeout(12_000) });
        markup = panel === "trend" ? trendMarkup(workbook) : backtestingMarkup(workbook);
      }
      if (requestVersion === selectionVersion) content.innerHTML = markup;
    } catch {
      if (requestVersion !== selectionVersion) return;
      content.innerHTML = `<div class="aq-atlas-empty"><strong>${panelLabels[panel]} is temporarily unavailable.</strong><p>No substitute research output is shown. You can retry from the atlas or open the full page when the public feed reconnects.</p></div>`;
    }
  };

  document.querySelectorAll<HTMLElement>("[data-atlas-open]").forEach((button) => {
    button.addEventListener("click", () => void open(button.dataset.atlasOpen as AtlasPanel));
  });
  document.querySelector<HTMLElement>("[data-atlas-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
