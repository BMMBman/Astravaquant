import type { MarketDashboard, MarketPoint } from "../shared/contracts.js";
import { apiRequest } from "./api.js";

function formatBillions(value: number): string {
  return `$${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 0 })}B`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function inputDate(value: string): string {
  return value.slice(0, 10);
}

function pathFor(points: MarketPoint[], width: number, height: number): { line: string; area: string; y: (value: number) => number } {
  const padding = { top: 20, right: 18, bottom: 28, left: 18 };
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (index: number) => padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((max - value) / range) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  return { line, area: `${line} L${x(points.length - 1).toFixed(1)} ${height - padding.bottom} L${x(0).toFixed(1)} ${height - padding.bottom} Z`, y };
}

function renderChart(root: HTMLElement, points: MarketPoint[]): void {
  if (points.length < 2) {
    root.classList.add("is-unavailable");
    root.innerHTML = "<span>Not enough aligned observations are available for this date range.</span>";
    return;
  }
  root.classList.remove("is-unavailable");
  const width = 780;
  const height = 246;
  const { line, area } = pathFor(points, width, height);
  const last = points.at(-1)!;
  root.innerHTML = `<div class="terminal-chart-readout"><time>${formatDate(last.timestamp)}</time><strong>${formatBillions(last.value)}</strong></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Net Fed liquidity history">
      <defs><linearGradient id="net-liquidity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#95b8a6" stop-opacity=".3"/><stop offset="1" stop-color="#95b8a6" stop-opacity="0"/></linearGradient></defs>
      <path d="M18 78H762 M18 140H762 M18 202H762" class="market-chart-gridline"/>
      <path d="${area}" fill="url(#net-liquidity-fill)"/>
      <path d="${line}" class="market-chart-line net-liquidity-line" pathLength="1"/>
      <text x="18" y="236" class="market-chart-date">${formatDate(points[0]!.timestamp)}</text>
      <text x="762" y="236" text-anchor="end" class="market-chart-date">${formatDate(last.timestamp)}</text>
    </svg>`;
}

function setStatus(root: HTMLElement, text: string, unavailable = false): void {
  root.textContent = text;
  root.classList.toggle("is-unavailable", unavailable);
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
    current.textContent = formatBillions(liquidity.value);
    asOf.textContent = `As of ${formatDate(liquidity.asOf ?? points.at(-1)!.timestamp)}`;
    setStatus(status, "FRED-derived weekly series");

    const render = () => {
      if (start.value > end.value) end.value = start.value;
      const visible = points.filter((point) => {
        const date = inputDate(point.timestamp);
        return date >= start.value && date <= end.value;
      });
      renderChart(chart, visible);
      range.textContent = visible.length ? `${formatDate(visible[0]!.timestamp)} - ${formatDate(visible.at(-1)!.timestamp)}` : "No observations in range";
    };
    start.addEventListener("change", render);
    end.addEventListener("change", render);
    render();
  } catch {
    current.textContent = "--";
    asOf.textContent = "No substitute reading is shown";
    setStatus(status, "FRED feed unavailable", true);
    chart.classList.add("is-unavailable");
    chart.innerHTML = "<span>Net Fed liquidity is temporarily unavailable.</span>";
  }
}
