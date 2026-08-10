import type {
  AuthSession,
  PerformancePeriod,
  PerformanceSeries,
  PortfolioDashboard,
  PortfolioHolding
} from "../shared/contracts.js";
import { apiRequest, ClientApiError } from "./api.js";
import {
  escapeHtml,
  formatBalance,
  formatCurrency,
  formatPercent,
  shortenAddress
} from "./format.js";

const allocationColors = ["#c9a56a", "#8caed3", "#d7c7a7", "#627a95", "#8f7652", "#717780"];

function toneClass(value: number | null): string {
  if (value === null) return "is-muted";
  return value >= 0 ? "is-positive" : "is-negative";
}

function performancePath(series: PerformanceSeries): { line: string; area: string } | null {
  if (series.points.length < 2) return null;
  const width = 720;
  const height = 220;
  const pad = 10;
  const values = series.points.map((point) => point.valueUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = series.points.map((point, index) => ({
    x: pad + (index / (series.points.length - 1)) * (width - pad * 2),
    y: height - pad - ((point.valueUsd - min) / range) * (height - pad * 2)
  }));
  const line = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L${coordinates.at(-1)!.x.toFixed(2)} ${height} L${coordinates[0]!.x.toFixed(2)} ${height} Z`;
  return { line, area };
}

function holdingLogo(holding: PortfolioHolding): string {
  if (holding.logoUrl) {
    return `<img src="${escapeHtml(holding.logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  }
  return escapeHtml(holding.symbol.slice(0, 1));
}

export class PortfolioController {
  private dashboard: PortfolioDashboard | null = null;
  private activePeriod: PerformancePeriod = "1M";
  private readonly gate = document.querySelector<HTMLElement>("[data-portfolio-gate]");
  private readonly loading = document.querySelector<HTMLElement>("[data-portfolio-loading]");
  private readonly content = document.querySelector<HTMLElement>("[data-portfolio-content]");
  private readonly error = document.querySelector<HTMLElement>("[data-portfolio-error]");

  constructor(private readonly onConnect: () => void) {
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-portfolio-connect]")) this.onConnect();
      const period = target.closest<HTMLElement>("[data-performance-period]")?.dataset.performancePeriod as
        | PerformancePeriod
        | undefined;
      if (period && this.dashboard) {
        this.activePeriod = period;
        this.renderPerformance();
      }
      if (target.closest("[data-portfolio-retry]")) void this.load();
    });
  }

  async updateSession(session: AuthSession): Promise<void> {
    if (!session.authenticated) {
      this.dashboard = null;
      this.show("gate");
      return;
    }
    await this.load();
  }

  private show(state: "gate" | "loading" | "content" | "error"): void {
    if (this.gate) this.gate.hidden = state !== "gate";
    if (this.loading) this.loading.hidden = state !== "loading";
    if (this.content) this.content.hidden = state !== "content";
    if (this.error) this.error.hidden = state !== "error";
  }

  private async load(): Promise<void> {
    this.show("loading");
    try {
      this.dashboard = await apiRequest<PortfolioDashboard>("/api/dashboard");
      this.render();
      this.show("content");
    } catch (error) {
      if (error instanceof ClientApiError && error.code === "AUTH_REQUIRED") {
        this.show("gate");
        return;
      }
      const message = this.error?.querySelector<HTMLElement>("[data-error-message]");
      if (message) message.textContent = error instanceof Error ? error.message : "Portfolio data could not be loaded.";
      this.show("error");
    }
  }

  private render(): void {
    if (!this.dashboard) return;
    const { portfolio, session, portfolioRegime } = this.dashboard;
    const setText = (selector: string, value: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (node) node.textContent = value;
    };

    setText("[data-portfolio-value]", formatCurrency(portfolio.totalValueUsd));
    setText("[data-portfolio-address]", session.address ? shortenAddress(session.address) : "--");
    setText("[data-portfolio-network]", portfolio.network);
    setText("[data-portfolio-assets]", String(portfolio.assetCount));
    setText("[data-portfolio-regime]", portfolioRegime.state);
    setText("[data-portfolio-asof]", portfolio.asOf ? `Updated ${new Date(portfolio.asOf).toLocaleString()}` : "Live holdings unavailable");

    const dailyChange = document.querySelector<HTMLElement>("[data-portfolio-daily-change]");
    if (dailyChange) {
      dailyChange.textContent = portfolio.change24hPct === null ? "24-hour change unavailable" : `${formatPercent(portfolio.change24hPct)} today`;
      dailyChange.className = `terminal-change ${toneClass(portfolio.change24hPct)}`;
    }

    const providerState = document.querySelector<HTMLElement>("[data-provider-state]");
    if (providerState) {
      providerState.hidden = portfolio.status === "ready";
      providerState.textContent = portfolio.message ?? "";
    }

    this.renderHoldings();
    this.renderAllocation();
    this.renderSignals();
    this.renderResearch();
    this.renderModelContext();
    this.renderPerformance();
  }

  private renderHoldings(): void {
    if (!this.dashboard) return;
    const body = document.querySelector<HTMLElement>("[data-holdings-body]");
    if (!body) return;
    const holdings = this.dashboard.portfolio.holdings;
    if (holdings.length === 0) {
      body.innerHTML = `<div class="portfolio-empty-row">${escapeHtml(this.dashboard.portfolio.message ?? "No supported assets were found.")}</div>`;
      return;
    }

    body.innerHTML = holdings
      .map(
        (holding) => `
          <div class="holding-row">
            <div class="holding-asset">
              <span class="holding-logo">${holdingLogo(holding)}</span>
              <span><strong>${escapeHtml(holding.symbol)}</strong><small>${escapeHtml(holding.name)}</small></span>
            </div>
            <div><span class="mobile-table-label">Balance</span><strong>${escapeHtml(formatBalance(holding.balance))}</strong></div>
            <div><span class="mobile-table-label">Value</span><strong>${formatCurrency(holding.valueUsd, 2)}</strong></div>
            <div><span class="mobile-table-label">Allocation</span><strong>${holding.allocationPct === null ? "--" : `${holding.allocationPct.toFixed(1)}%`}</strong></div>
            <div class="${toneClass(holding.change24hPct)}"><span class="mobile-table-label">24H</span><strong>${formatPercent(holding.change24hPct)}</strong></div>
          </div>
        `
      )
      .join("");
  }

  private renderAllocation(): void {
    if (!this.dashboard) return;
    const chart = document.querySelector<HTMLElement>("[data-allocation-chart]");
    const legend = document.querySelector<HTMLElement>("[data-allocation-legend]");
    if (!chart || !legend) return;
    const holdings = this.dashboard.portfolio.holdings.filter((holding) => holding.allocationPct !== null);
    if (holdings.length === 0) {
      chart.style.background = "rgba(255,255,255,0.05)";
      legend.innerHTML = '<p class="muted-note">Allocation appears when priced holdings are available.</p>';
      return;
    }

    const slices: Array<{ symbol: string; allocationPct: number }> = holdings.slice(0, 5).map((holding) => ({
      symbol: holding.symbol,
      allocationPct: holding.allocationPct ?? 0
    }));
    const other = holdings.slice(5).reduce((total, holding) => total + (holding.allocationPct ?? 0), 0);
    if (other > 0) slices.push({ symbol: "Other", allocationPct: other });
    let cursor = 0;
    const stops = slices.map((slice, index) => {
      const start = cursor;
      cursor += slice.allocationPct;
      return `${allocationColors[index]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    chart.style.background = `conic-gradient(${stops.join(",")})`;
    legend.innerHTML = slices
      .map(
        (slice, index) => `
          <div class="allocation-legend-row">
            <span><i style="background:${allocationColors[index]}"></i>${escapeHtml(slice.symbol)}</span>
            <strong>${slice.allocationPct.toFixed(1)}%</strong>
          </div>
        `
      )
      .join("");
  }

  private renderSignals(): void {
    if (!this.dashboard) return;
    const container = document.querySelector<HTMLElement>("[data-personalized-signals]");
    if (!container) return;
    container.innerHTML = this.dashboard.signals
      .map(
        (signal) => `
          <article class="personal-signal-card">
            <span>${escapeHtml(signal.name)}</span>
            <strong>${signal.value >= 0 ? "+" : ""}${signal.value.toFixed(2)}</strong>
            <b>${escapeHtml(signal.state)}</b>
            <p>${escapeHtml(signal.scope)}</p>
          </article>
        `
      )
      .join("");
  }

  private renderResearch(): void {
    if (!this.dashboard) return;
    const container = document.querySelector<HTMLElement>("[data-personalized-research]");
    if (!container) return;
    if (this.dashboard.research.length === 0) {
      container.innerHTML = '<div class="portfolio-empty-row">Relevant research will appear when supported holdings are available.</div>';
      return;
    }
    container.innerHTML = this.dashboard.research
      .map(
        (research) => `
          <a class="portfolio-research-row" href="${escapeHtml(research.href)}">
            <span><strong>${escapeHtml(research.title)}</strong><small>${escapeHtml(research.summary)}</small></span>
            <b>${research.relevance.toFixed(0)}% relevance</b>
            <i aria-hidden="true">→</i>
          </a>
        `
      )
      .join("");
  }

  private renderModelContext(): void {
    if (!this.dashboard) return;
    const portfolio = document.querySelector<HTMLElement>("[data-model-portfolio]");
    const model = document.querySelector<HTMLElement>("[data-model-allocation]");
    const note = document.querySelector<HTMLElement>("[data-model-note]");
    if (!portfolio || !model || !note) return;
    const context = this.dashboard.allocationContext;
    portfolio.innerHTML = context.portfolio.length
      ? context.portfolio
          .map(
            (item) => `
              <div class="model-allocation-row">
                <span>${escapeHtml(item.symbol)}</span>
                <div><i style="width:${Math.min(item.allocationPct, 100).toFixed(2)}%"></i></div>
                <strong>${item.allocationPct.toFixed(1)}%</strong>
              </div>
            `
          )
          .join("")
      : '<p class="muted-note">Allocation unavailable.</p>';
    model.innerHTML = '<div class="model-unpublished"><span>Model allocation</span><strong>Not published</strong></div>';
    note.textContent = context.message;
  }

  private renderPerformance(): void {
    if (!this.dashboard) return;
    const series = this.dashboard.performance[this.activePeriod];
    const buttons = document.querySelectorAll<HTMLElement>("[data-performance-period]");
    for (const button of buttons) {
      button.classList.toggle("is-active", button.dataset.performancePeriod === this.activePeriod);
    }
    const value = document.querySelector<HTMLElement>("[data-performance-value]");
    const change = document.querySelector<HTMLElement>("[data-performance-change]");
    const chart = document.querySelector<SVGSVGElement>("[data-performance-chart]");
    const empty = document.querySelector<HTMLElement>("[data-performance-empty]");
    if (!value || !change || !chart || !empty) return;

    value.textContent = formatCurrency(series.endValueUsd);
    change.textContent = series.status === "ready"
      ? `${formatPercent(series.changePct)} · ${formatCurrency(series.changeUsd, 2)}`
      : "Awaiting verified history";
    change.className = `performance-change ${toneClass(series.changePct)}`;
    const path = performancePath(series);
    empty.hidden = Boolean(path);
    empty.textContent = series.message ?? "";
    chart.toggleAttribute("hidden", !path);
    chart.innerHTML = path
      ? `<defs><linearGradient id="portfolioArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(201,165,106,.28)"/><stop offset="100%" stop-color="rgba(201,165,106,0)"/></linearGradient></defs><path d="${path.area}" fill="url(#portfolioArea)"/><path d="${path.line}" class="performance-line"/>`
      : "";
  }
}
