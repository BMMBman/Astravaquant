import type {
  BitcoinValuationDashboard,
  MarketDashboard,
  MarketMetric,
  ValuationCategoryId,
  ValuationIndicator,
  WorkbookDashboard,
  WorkbookScoreSeries
} from "../shared/contracts.js";
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
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
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

function trillions(value: number | null): string {
  if (value === null) return "--";
  return "$" + (value / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + "T";
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

function observationState(value: number): { label: string; tone: "positive" | "negative" | "neutral" } {
  if (value >= 0.25) return { label: "Risk-on", tone: "positive" };
  if (value <= -0.25) return { label: "Risk-off", tone: "negative" };
  return { label: "Neutral", tone: "neutral" };
}

function interactiveHistoryMarkup(series: WorkbookScoreSeries): string {
  const points = series.points;
  if (!points.length) return '<div class="aq-atlas-sparkline is-unavailable">No dated observations published</div>';

  const width = 640;
  const height = 148;
  const padding = { x: 20, y: 18 };
  const scores = points.map((point) => point.score);
  const minimum = Math.min(-1, ...scores);
  const maximum = Math.max(1, ...scores);
  const span = maximum - minimum || 1;
  const dates = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const firstDate = dates[0]!;
  const lastDate = dates.at(-1)!;
  const dateSpan = lastDate - firstDate || 1;
  const x = (index: number) => points.length === 1
    ? width / 2
    : padding.x + ((dates[index]! - firstDate) / dateSpan) * (width - padding.x * 2);
  const y = (value: number) => padding.y + ((maximum - value) / span) * (height - padding.y * 2);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join(" ");
  const currentIndex = points.length - 1;
  const current = points[currentIndex]!;
  const currentState = observationState(current.score);
  const observations = [...points].reverse().map((point) => {
    const state = observationState(point.score);
    return `<li><time datetime="${escapeHtml(point.date)}">${escapeHtml(date(point.date))}</time><strong>${score(point.score)}</strong><span class="is-${state.tone}">${state.label}</span></li>`;
  }).join("");

  return `<section class="aq-atlas-history" data-atlas-history-series="${escapeHtml(series.id)}">
    <div class="aq-atlas-history-head"><div><span>Dated score history</span><small>Hover or click the chart. Tap a point on mobile.</small></div><div class="aq-atlas-history-readout" data-atlas-history-readout aria-live="polite"><time>${escapeHtml(date(current.date))}</time><strong>${score(current.score)}</strong><span class="is-${currentState.tone}">${currentState.label}</span></div></div>
    <div class="aq-atlas-history-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series.label)} dated score history" data-atlas-history-chart>
        <path d="M${padding.x} ${y(0).toFixed(1)} H${width - padding.x}" class="aq-atlas-history-zero"/>
        <path d="${line}" class="aq-atlas-history-line"/>
        <line x1="${x(currentIndex).toFixed(1)}" x2="${x(currentIndex).toFixed(1)}" y1="${padding.y}" y2="${height - padding.y}" class="aq-atlas-history-guide" data-atlas-history-guide/>
        <circle cx="${x(currentIndex).toFixed(1)}" cy="${y(current.score).toFixed(1)}" r="5" class="aq-atlas-history-dot" data-atlas-history-dot/>
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" data-atlas-history-hit/>
      </svg>
    </div>
    <div class="aq-atlas-history-controls">
      <button type="button" data-atlas-history-previous aria-label="Previous dated observation">Previous</button>
      <input type="range" min="0" max="${currentIndex}" value="${currentIndex}" step="1" aria-label="Select a dated observation" data-atlas-history-scrubber />
      <button type="button" data-atlas-history-next aria-label="Next dated observation">Next</button>
    </div>
    <div class="aq-atlas-history-range"><span>${escapeHtml(date(points[0]!.date))}</span><output data-atlas-history-position>${points.length} of ${points.length}</output><span>${escapeHtml(date(current.date))}</span></div>
    <details class="aq-atlas-observation-record"><summary>View ${points.length} dated observation${points.length === 1 ? "" : "s"}</summary><ol>${observations}</ol></details>
  </section>`;
}

function bindInteractiveHistory(content: HTMLElement, series: WorkbookScoreSeries[]): void {
  content.querySelectorAll<HTMLElement>("[data-atlas-history-series]").forEach((root) => {
    const activeSeries = series.find((item) => item.id === root.dataset.atlasHistorySeries);
    if (!activeSeries?.points.length) return;
    const points = activeSeries.points;
    const chart = root.querySelector<SVGElement>("[data-atlas-history-chart]");
    const guide = root.querySelector<SVGLineElement>("[data-atlas-history-guide]");
    const dot = root.querySelector<SVGCircleElement>("[data-atlas-history-dot]");
    const readout = root.querySelector<HTMLElement>("[data-atlas-history-readout]");
    const scrubber = root.querySelector<HTMLInputElement>("[data-atlas-history-scrubber]");
    const position = root.querySelector<HTMLOutputElement>("[data-atlas-history-position]");
    const previous = root.querySelector<HTMLButtonElement>("[data-atlas-history-previous]");
    const next = root.querySelector<HTMLButtonElement>("[data-atlas-history-next]");
    if (!chart || !readout || !scrubber) return;

    const width = 640;
    const height = 148;
    const padding = { x: 20, y: 18 };
    const scores = points.map((point) => point.score);
    const minimum = Math.min(-1, ...scores);
    const maximum = Math.max(1, ...scores);
    const scoreSpan = maximum - minimum || 1;
    const dates = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
    const firstDate = dates[0]!;
    const dateSpan = dates.at(-1)! - firstDate || 1;
    const x = (index: number) => points.length === 1
      ? width / 2
      : padding.x + ((dates[index]! - firstDate) / dateSpan) * (width - padding.x * 2);
    const y = (value: number) => padding.y + ((maximum - value) / scoreSpan) * (height - padding.y * 2);
    let selectedIndex = points.length - 1;

    const select = (index: number) => {
      selectedIndex = Math.min(points.length - 1, Math.max(0, index));
      const point = points[selectedIndex]!;
      const state = observationState(point.score);
      const pointX = x(selectedIndex).toFixed(1);
      guide?.setAttribute("x1", pointX);
      guide?.setAttribute("x2", pointX);
      dot?.setAttribute("cx", pointX);
      dot?.setAttribute("cy", y(point.score).toFixed(1));
      readout.innerHTML = `<time>${escapeHtml(date(point.date))}</time><strong>${score(point.score)}</strong><span class="is-${state.tone}">${state.label}</span>`;
      scrubber.value = String(selectedIndex);
      if (position) position.textContent = `${selectedIndex + 1} of ${points.length}`;
      if (previous) previous.disabled = selectedIndex === 0;
      if (next) next.disabled = selectedIndex === points.length - 1;
    };

    const selectFromPointer = (event: PointerEvent) => {
      const rect = chart.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const targetX = ratio * width;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      points.forEach((_, index) => {
        const distance = Math.abs(x(index) - targetX);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      select(nearestIndex);
    };

    chart.addEventListener("pointermove", selectFromPointer);
    chart.addEventListener("pointerdown", (event) => {
      selectFromPointer(event);
    });
    chart.addEventListener("pointerup", selectFromPointer);
    scrubber.addEventListener("input", () => select(Number(scrubber.value)));
    previous?.addEventListener("click", () => select(selectedIndex - 1));
    next?.addEventListener("click", () => select(selectedIndex + 1));
    select(selectedIndex);
  });
}

function scalePosition(value: number | null, minimum: number, maximum: number): number {
  if (value === null) return 50;
  return Math.min(100, Math.max(0, (value - minimum) / (maximum - minimum) * 100));
}

function riskScale(value: number | null): string {
  const position = scalePosition(value, -1, 1);
  return `<div class="aq-atlas-risk-scale" aria-label="Risk scale from negative one risk-off to positive one risk-on">
    <div class="aq-atlas-risk-scale-labels"><span>−1 Risk-off</span><span>0 Neutral</span><span>+1 Risk-on</span></div>
    <div class="aq-atlas-risk-rail"><i style="left:${position.toFixed(2)}%"></i></div>
  </div>`;
}

function signalCard(series: WorkbookScoreSeries | undefined, label: string, state: string, updated: string | null | undefined): string {
  const latest = series?.points.at(-1) ?? null;
  return `<article class="aq-atlas-card">
    <p>${escapeHtml(label)}</p><strong>${score(latest?.score ?? null)}</strong><b>${escapeHtml(state)}</b>
    ${series ? interactiveHistoryMarkup(series) : '<div class="aq-atlas-sparkline is-unavailable">History unavailable</div>'}
    ${riskScale(latest?.score ?? null)}
    <small>${latest ? `${date(latest.date)} / ${series?.points.length ?? 0} dated observations` : `Published ${date(updated)}`}</small>
  </article>`;
}

function trendMarkup(workbook: WorkbookDashboard): string {
  const signals = new Map(workbook.signals.map((signal) => [signal.id, signal]));
  const series = new Map(workbook.scoreSeries.map((item) => [item.id, item]));
  const medium = signals.get("mtpi");
  const long = signals.get("ltpi");
  return `<div class="aq-atlas-intro"><span>Two horizons, one research family</span><p>Medium-term trend follows Total Crypto Market Cap and Total2. Long-term trend combines Bitcoin long-term behavior with Total Crypto Market Cap.</p></div>
    <div class="aq-atlas-grid two">${signalCard(series.get("mtpi"), "Medium-Term Trend / MTTPM", medium?.state ?? "Unavailable", medium?.updatedLabel)}${signalCard(series.get("ltpi"), "Long-Term Trend / LTTPM", long?.state ?? "Unavailable", long?.updatedLabel)}</div>
    <div class="aq-atlas-foot"><span>Published signal state and dated forward-test record.</span></div>`;
}

function valuationIndicatorMarkup(indicators: ValuationIndicator[], category: ValuationCategoryId): string {
  const filtered = indicators.filter((indicator) => indicator.category === category);
  if (!filtered.length) return '<p class="aq-atlas-empty">No verified indicators are available for this composite.</p>';
  return `<div class="aq-atlas-indicator-list">${filtered.map((indicator) => {
    const position = scalePosition(indicator.score, -3, 3);
    return `<article>
      <div><strong>${escapeHtml(indicator.name)}</strong><p>${escapeHtml(indicator.description || "Verified composite input.")}</p></div>
      <b>${score(indicator.score, "σ")}</b><span>${escapeHtml(indicator.state)}</span>
      <div class="aq-atlas-indicator-rail" aria-hidden="true"><i style="left:${position.toFixed(2)}%"></i></div>
    </article>`;
  }).join("")}</div>`;
}

function valuationMarkup(valuation: BitcoinValuationDashboard): string {
  const categories = valuation.categories.map((category) => `<button type="button" data-atlas-valuation-category="${category.id}"><span>${escapeHtml(category.label)}</span><strong>${score(category.averageScore, "σ")}</strong><small>${category.indicatorCount} inputs</small></button>`).join("");
  return `<div class="aq-atlas-score"><span>Current Z-score</span><strong>${score(valuation.score, "σ")}</strong><b>${escapeHtml(valuation.state ?? "Unavailable")}</b><small>Published ${date(valuation.workbookUpdatedLabel)}</small></div>
    ${sparkline(valuation.history)}
    <div class="aq-atlas-categories">${categories || '<span>Category inputs unavailable</span>'}</div>
    <section class="aq-atlas-indicator-panel"><div><span>Composite indicators</span><p>Select a composite to inspect the verified inputs.</p></div><div data-atlas-valuation-indicators>${valuationIndicatorMarkup(valuation.indicators, "fundamental")}</div></section>
    <div class="aq-atlas-foot"><span>Composite reading across fundamental, technical, and sentiment inputs.</span></div>`;
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
    const points = metric ? metric.points.map((point) => ({ date: point.timestamp, score: point.value })) : [];
    return `<div><code>${component.code}</code><span>${component.label}</span><strong>${billions(metric?.value ?? null, metric?.unit === "usd_billions")}</strong><b>${component.subtract ? "Subtract" : "Add"}</b>${sparkline(points)}</div>`;
  }).join("");
  const netPoints = net ? net.points.map((point) => ({ date: point.timestamp, score: point.value })) : [];
  const netValue = net?.value ?? null;
  return `<div class="aq-atlas-score"><span>Derived net liquidity</span><strong>${trillions(netValue)}</strong><b>${net?.status === "ready" ? "FRED-derived weekly series" : "Feed unavailable"}</b><small>${net?.asOf ? `As of ${date(net.asOf)}` : "No substitute reading"}</small><em>${billions(netValue)} / approx. ${netValue === null ? "--" : "$" + (netValue * 1_000_000).toLocaleString("en-US")}</em></div>
    <section class="aq-atlas-series-panel"><div><span>Net liquidity history</span><p>Weekly derived series from the five formula components.</p></div>${sparkline(netPoints)}</section>
    <div class="aq-atlas-formula"><span>WALCL - TGA - RRPONTSYD + H41RESPPALDKNWW + WLCFLPCL</span><small>All inputs aligned in millions of U.S. dollars.</small></div>
    <details class="aq-atlas-info-panel"><summary>What this measures and why it matters</summary><div><p><strong>What it measures.</strong> Net Fed Liquidity starts with total Federal Reserve assets, subtracts cash held in the Treasury General Account and the reverse-repo facility, then adds active Fed funding facilities.</p><p><strong>Why it matters.</strong> It is a balance-sheet context measure for the liquidity available to the financial system. It can help frame risk conditions, but it does not establish causation, predict returns, or function as a trading recommendation.</p></div></details>
    <div class="aq-atlas-components">${components}</div>
    <div class="aq-atlas-foot"><span>Five first-party FRED inputs, aligned to a weekly liquidity series.</span></div>`;
}

function diagnosticsCard(series: WorkbookScoreSeries): string {
  const analysis = analyzeScoreSeries(series.points);
  const current = analysis.currentRegime === "risk_on" ? "Risk-on" : analysis.currentRegime === "risk_off" ? "Risk-off" : "Neutral";
  const latest = series.points.at(-1)?.score ?? null;
  return `<article class="aq-atlas-card"><p>${escapeHtml(series.label)}</p><strong>${score(latest)}</strong><b>${current}</b>${interactiveHistoryMarkup(series)}${riskScale(latest)}<small>${analysis.observations} dated observations / ${analysis.transitions.length} transitions / ${analysis.currentStreak} observation current streak</small></article>`;
}

function backtestingMarkup(workbook: WorkbookDashboard): string {
  const series = workbook.scoreSeries.filter((item) => item.id === "mtpi" || item.id === "ltpi");
  return `<div class="aq-atlas-intro"><span>Forward-testing diagnostics</span><p>Counts and transitions describe the published score history. They are not performance claims.</p></div>
    <div class="aq-atlas-grid two">${series.length ? series.map(diagnosticsCard).join("") : '<p class="aq-atlas-empty">Dated trend observations are unavailable.</p>'}</div>
    <div class="aq-atlas-foot"><span>Classification history is shown as a dated research record, not a performance claim.</span></div>`;
}

function bindValuationControls(content: HTMLElement, valuation: BitcoinValuationDashboard): void {
  const buttons = [...content.querySelectorAll<HTMLButtonElement>("[data-atlas-valuation-category]")];
  const indicatorRoot = content.querySelector<HTMLElement>("[data-atlas-valuation-indicators]");
  if (!indicatorRoot) return;

  const selectCategory = (category: ValuationCategoryId) => {
    buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.atlasValuationCategory === category));
    indicatorRoot.innerHTML = valuationIndicatorMarkup(valuation.indicators, category);
  };

  buttons.forEach((button) => button.addEventListener("click", () => selectCategory(button.dataset.atlasValuationCategory as ValuationCategoryId)));
  selectCategory("fundamental");
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
      let valuation: BitcoinValuationDashboard | null = null;
      let workbook: WorkbookDashboard | null = null;
      if (panel === "valuation") {
        valuation = await apiRequest<BitcoinValuationDashboard>("/api/valuation", { signal: AbortSignal.timeout(12_000) });
        markup = valuationMarkup(valuation);
      } else if (panel === "liquidity") {
        const markets = await apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(12_000) });
        markup = liquidityMarkup(markets);
      } else {
        workbook = await apiRequest<WorkbookDashboard>("/api/workbook", { signal: AbortSignal.timeout(12_000) });
        markup = panel === "trend" ? trendMarkup(workbook) : backtestingMarkup(workbook);
      }
      if (requestVersion === selectionVersion) {
        content.innerHTML = markup;
        if (valuation) bindValuationControls(content, valuation);
        if (workbook) bindInteractiveHistory(content, workbook.scoreSeries);
      }
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
