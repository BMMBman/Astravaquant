import type { MarketDashboard, MarketMetric, MarketPoint } from "../shared/contracts.js";
import { apiRequest } from "./api.js";

function formatLiquidity(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}T`;
  }
  if (absolute >= 1_000) {
    return `$${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 0 })}B`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
}

function formatDelta(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatLiquidity(Math.abs(value))}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function inputDate(value: string): string {
  return value.slice(0, 10);
}

function pathFor(points: MarketPoint[], width: number, height: number): {
  line: string;
  area: string;
  min: number;
  max: number;
  x: (index: number) => number;
  y: (value: number) => number;
} {
  const padding = { top: 20, right: 18, bottom: 28, left: 74 };
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (index: number) => padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((max - value) / range) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  return {
    line,
    area: `${line} L${x(points.length - 1).toFixed(1)} ${height - padding.bottom} L${x(0).toFixed(1)} ${height - padding.bottom} Z`,
    min,
    max,
    x,
    y
  };
}

function renderChart(root: HTMLElement, points: MarketPoint[], requestedIndex = points.length - 1): void {
  if (points.length < 2) {
    root.classList.add("is-unavailable");
    root.innerHTML = "<span>Not enough aligned observations are available for this date range.</span>";
    return;
  }
  root.classList.remove("is-unavailable");
  const width = 780;
  const height = 246;
  const selectedIndex = Math.min(Math.max(requestedIndex, 0), points.length - 1);
  const selected = points[selectedIndex]!;
  const { line, area, min, max, x, y } = pathFor(points, width, height);
  const midpoint = min + (max - min) / 2;
  const selectedX = x(selectedIndex);
  const selectedY = y(selected.value);
  root.innerHTML = `<div class="terminal-chart-readout"><time>${formatDate(selected.timestamp)}</time><strong>${formatLiquidity(selected.value)}</strong></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Net Fed liquidity history from ${formatDate(points[0]!.timestamp)} to ${formatDate(points.at(-1)!.timestamp)}">
      <defs><linearGradient id="net-liquidity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5ff" stop-opacity=".18"/><stop offset="1" stop-color="#00e5ff" stop-opacity="0"/></linearGradient></defs>
      <path d="M74 20H762 M74 119H762 M74 218H762" class="market-chart-gridline"/>
      <text x="64" y="24" text-anchor="end" class="market-chart-value">${formatLiquidity(max)}</text>
      <text x="64" y="123" text-anchor="end" class="market-chart-value">${formatLiquidity(midpoint)}</text>
      <text x="64" y="222" text-anchor="end" class="market-chart-value">${formatLiquidity(min)}</text>
      <path d="${area}" fill="url(#net-liquidity-fill)"/>
      <path d="${line}" class="market-chart-line net-liquidity-line"/>
      <line x1="${selectedX.toFixed(1)}" y1="20" x2="${selectedX.toFixed(1)}" y2="218" class="net-liquidity-cursor"/>
      <circle cx="${selectedX.toFixed(1)}" cy="${selectedY.toFixed(1)}" r="5" class="net-liquidity-point"/>
      <text x="74" y="240" class="market-chart-date">${formatDate(points[0]!.timestamp)}</text>
      <text x="762" y="240" text-anchor="end" class="market-chart-date">${formatDate(points.at(-1)!.timestamp)}</text>
    </svg>`;
}

function setStatus(root: HTMLElement, text: string, unavailable = false): void {
  root.textContent = text;
  root.classList.toggle("is-unavailable", unavailable);
}

const components = [
  { id: "fedLiquidity", code: "WALCL", label: "Federal Reserve assets", direction: "Adds liquidity", billions: false, sign: 1 },
  { id: "treasuryGeneralAccount", code: "WTREGEN", label: "Treasury General Account", direction: "Removes liquidity", billions: false, sign: -1 },
  { id: "reverseRepo", code: "RRPONTSYD", label: "Overnight reverse repo", direction: "Removes liquidity", billions: true, sign: -1 },
  { id: "bankTermFundingProgram", code: "H41RESPPALDKNWW", label: "Bank Term Funding Program", direction: "Adds liquidity", billions: false, sign: 1 },
  { id: "primaryCredit", code: "WLCFLPCL", label: "Primary credit loans", direction: "Adds liquidity", billions: false, sign: 1 }
] as const;

function componentValueInMillions(metric: MarketMetric | undefined, value: number | null | undefined, billions: boolean): number | null {
  if (!metric || value === null || value === undefined) return null;
  return billions ? value * 1_000 : value;
}

function componentContribution(metric: MarketMetric | undefined, billions: boolean, sign: number): number | null {
  const latest = metric?.points.at(-1)?.value;
  const previous = metric?.points.at(-2)?.value;
  const latestMillions = componentValueInMillions(metric, latest, billions);
  const previousMillions = componentValueInMillions(metric, previous, billions);
  if (latestMillions === null || previousMillions === null) return null;
  return (latestMillions - previousMillions) * sign;
}

function componentSparkline(points: MarketPoint[]): string {
  if (points.length < 2) return "<span>History unavailable</span>";
  const width = 160;
  const height = 42;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const line = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = 4 + ((max - point.value) / range) * (height - 8);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Component history"><path d="${line}" class="net-liquidity-sparkline"/></svg>`;
}

function renderComponents(root: HTMLElement, dashboard: MarketDashboard, start: string, end: string): void {
  root.innerHTML = components.map((component) => {
    const metric = dashboard.metrics.find((candidate) => candidate.id === component.id);
    const points = (metric?.points ?? []).filter((point) => {
      const date = inputDate(point.timestamp);
      return date >= start && date <= end;
    });
    const valueInMillions = componentValueInMillions(metric, metric?.value, component.billions);
    const contribution = componentContribution(metric, component.billions, component.sign);
    const contributionCopy = contribution === null ? "Weekly contribution unavailable" : `${formatDelta(contribution)} weekly net contribution`;
    return `<article><code>${component.code}</code><strong>${valueInMillions === null ? "--" : formatLiquidity(valueInMillions)}</strong><span>${component.label}</span><b>${component.direction}</b><small class="${contribution !== null && contribution < 0 ? "is-contracting" : "is-expanding"}">${contributionCopy}</small><div class="aq-liquidity-sparkline">${componentSparkline(points)}</div></article>`;
  }).join("");
}

function setTone(root: HTMLElement | null, delta: number | null): void {
  if (!root) return;
  root.classList.toggle("is-expanding", delta !== null && delta > 0);
  root.classList.toggle("is-contracting", delta !== null && delta < 0);
}

function difference(points: MarketPoint[], periodsBack: number): number | null {
  if (points.length <= periodsBack) return null;
  return points.at(-1)!.value - points.at(-(periodsBack + 1))!.value;
}

function renderState(root: HTMLElement, dashboard: MarketDashboard, liquidity: MarketMetric): void {
  const points = liquidity.points;
  const weekly = difference(points, 1);
  const fourWeek = difference(points, 4);
  const weeklyRoot = root.querySelector<HTMLElement>("[data-net-liquidity-weekly]");
  const fourWeekRoot = root.querySelector<HTMLElement>("[data-net-liquidity-four-week]");
  const directionRoot = root.querySelector<HTMLElement>("[data-net-liquidity-direction]");
  const driverRoot = root.querySelector<HTMLElement>("[data-net-liquidity-driver]");
  const driverDetailRoot = root.querySelector<HTMLElement>("[data-net-liquidity-driver-detail]");
  const briefTitle = root.querySelector<HTMLElement>("[data-net-liquidity-brief-title]");
  const briefCopy = root.querySelector<HTMLElement>("[data-net-liquidity-brief-copy]");

  if (weeklyRoot) weeklyRoot.textContent = weekly === null ? "--" : formatDelta(weekly);
  if (fourWeekRoot) fourWeekRoot.textContent = fourWeek === null ? "--" : formatDelta(fourWeek);
  if (directionRoot) directionRoot.textContent = weekly === null ? "Unavailable" : weekly > 0 ? "Expanding" : weekly < 0 ? "Contracting" : "Unchanged";
  setTone(weeklyRoot, weekly);
  setTone(fourWeekRoot, fourWeek);
  setTone(directionRoot, weekly);

  const drivers = components.flatMap((component) => {
    const metric = dashboard.metrics.find((candidate) => candidate.id === component.id);
    const contribution = componentContribution(metric, component.billions, component.sign);
    return contribution === null ? [] : [{ ...component, contribution }];
  });
  const driver = drivers.sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))[0];
  if (driverRoot) driverRoot.textContent = driver?.label ?? "Unavailable";
  if (driverDetailRoot) {
    driverDetailRoot.textContent = driver
      ? `${formatDelta(driver.contribution)} net contribution in the latest observation.`
      : "Component changes are not available.";
  }

  const state = weekly === null ? "not yet classifiable" : weekly > 0 ? "expanded" : weekly < 0 ? "contracted" : "was unchanged";
  if (briefTitle) briefTitle.textContent = `Net liquidity ${state} in the latest week.`;
  if (briefCopy) {
    const fourWeekCopy = fourWeek === null
      ? "The four-week comparison is unavailable."
      : `Across four weeks, the derived balance-sheet measure changed ${formatDelta(fourWeek)}.`;
    const driverCopy = driver
      ? `${driver.label} was the largest latest-week contribution at ${formatDelta(driver.contribution)}.`
      : "The latest component driver is unavailable.";
    briefCopy.textContent = `${fourWeekCopy} ${driverCopy} This is financial-conditions context, not a stand-alone trading instruction.`;
  }
}

export async function bootNetLiquidity(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-net-liquidity]");
  if (!root) return;
  const chart = root.querySelector<HTMLElement>("[data-net-liquidity-chart]");
  const current = root.querySelector<HTMLElement>("[data-net-liquidity-current]");
  const asOf = root.querySelector<HTMLElement>("[data-net-liquidity-as-of]");
  const status = root.querySelector<HTMLElement>("[data-net-liquidity-status]");
  const start = root.querySelector<HTMLInputElement>("[data-net-liquidity-start]");
  const end = root.querySelector<HTMLInputElement>("[data-net-liquidity-end]");
  const range = root.querySelector<HTMLElement>("[data-net-liquidity-range]");
  const observation = root.querySelector<HTMLInputElement>("[data-net-liquidity-observation]");
  const componentRoot = root.querySelector<HTMLElement>("[data-net-liquidity-components]");
  if (!chart || !current || !asOf || !status || !start || !end || !range) return;

  try {
    const dashboard = await apiRequest<MarketDashboard>("/api/markets", { signal: AbortSignal.timeout(15_000) });
    const liquidity = dashboard.metrics.find((metric) => metric.id === "fedNetLiquidity");
    if (!liquidity || liquidity.status !== "ready" || liquidity.value === null || liquidity.points.length < 2) throw new Error("Net liquidity unavailable");
    const points = liquidity.points;
    const earliest = inputDate(points[0]!.timestamp);
    const latest = inputDate(points.at(-1)!.timestamp);
    start.min = earliest;
    start.max = latest;
    end.min = earliest;
    end.max = latest;
    start.value = earliest;
    end.value = latest;
    current.textContent = formatLiquidity(liquidity.value);
    asOf.textContent = `As of ${formatDate(liquidity.asOf ?? points.at(-1)!.timestamp)}`;
    setStatus(status, "FRED-derived / live");
    renderState(root, dashboard, liquidity);

    let visible: MarketPoint[] = points;
    const render = (requestedIndex?: number) => {
      if (start.value > end.value) end.value = start.value;
      visible = points.filter((point) => {
        const date = inputDate(point.timestamp);
        return date >= start.value && date <= end.value;
      });
      const selectedIndex = requestedIndex ?? Math.max(0, visible.length - 1);
      renderChart(chart, visible, selectedIndex);
      range.textContent = visible.length ? `${formatDate(visible[0]!.timestamp)} — ${formatDate(visible.at(-1)!.timestamp)}` : "No observations in range";
      if (observation) {
        observation.max = String(Math.max(0, visible.length - 1));
        observation.value = String(Math.min(selectedIndex, Math.max(0, visible.length - 1)));
        observation.disabled = visible.length < 2;
      }
      if (componentRoot) renderComponents(componentRoot, dashboard, start.value, end.value);
    };
    start.addEventListener("change", () => render());
    end.addEventListener("change", () => render());
    observation?.addEventListener("input", () => render(Number(observation.value)));
    render();
  } catch {
    current.textContent = "--";
    asOf.textContent = "No substitute reading is shown";
    setStatus(status, "FRED feed unavailable", true);
    chart.classList.add("is-unavailable");
    chart.innerHTML = "<span>Net Fed liquidity is temporarily unavailable.</span>";
  }
}
