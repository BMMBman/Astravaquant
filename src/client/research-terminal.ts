import type {
  AuthSession,
  PublishedScoreRecord,
  ResearchStrategy,
  ResearchTerminalDashboard,
  WorkbookScorePoint,
  WorkbookScoreSeries
} from "../shared/contracts.js";
import { apiRequest, ClientApiError } from "./api.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function score(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function date(value: string | null | undefined, withTime = false): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: "UTC"
  }).format(parsed);
}

function tone(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value >= 0 ? "is-positive" : "is-negative";
}

function statusTone(status: string): string {
  if (status === "ready") return "is-positive";
  if (status === "partial") return "is-warning";
  return "is-negative";
}

function setHtml(selector: string, value: string): void {
  const node = document.querySelector<HTMLElement>(selector);
  if (node) node.innerHTML = value;
}

function miniChart(series: WorkbookScoreSeries | null, height = 80): string {
  const points = series?.points ?? [];
  if (points.length < 2) return '<div class="rt-chart-unavailable" style="min-height:120px"><strong>History unavailable</strong><span>No populated dated score series is available.</span></div>';
  const width = 500;
  const pad = 5;
  const line = points.map((point, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = pad + ((1 - point.score) / 2) * (height - pad * 2);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="rt-mini-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series?.label ?? "Model")} dated score history"><path d="${line}"/></svg>`;
}

function fullScoreChart(series: WorkbookScoreSeries | null): string {
  const points = series?.points ?? [];
  if (points.length < 2) return '<div class="rt-chart-unavailable"><div class="rt-chart-grid"></div><strong>Dated score history unavailable</strong><span>The forward-test tab does not yet contain enough populated observations.</span></div>';
  const width = 1000;
  const height = 280;
  const pad = { left: 45, right: 22, top: 22, bottom: 38 };
  const x = (index: number) => pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + ((1 - value) / 2) * (height - pad.top - pad.bottom);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join(" ");
  const ticks = [-1, -.5, 0, .5, 1];
  return `<div style="padding:14px;overflow-x:auto"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(series!.label)} forward-test score history" style="min-width:680px;width:100%;height:auto">
    ${ticks.map((tick) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="rgba(162,181,207,.1)"/><text x="${pad.left - 9}" y="${y(tick) + 4}" text-anchor="end" fill="#59667a" font-size="11">${tick > 0 ? "+" : ""}${tick.toFixed(1)}</text>`).join("")}
    <line x1="${x(0)}" x2="${x(0)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="#df43d8" stroke-dasharray="4 5"/><text x="${x(0) + 7}" y="${pad.top + 10}" fill="#b58bb9" font-size="11">Forward-test start</text>
    <path d="${line}" fill="none" stroke="#00d8ee" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(points.length - 1)}" cy="${y(points.at(-1)!.score)}" r="4" fill="#eef3f8"/>
    <text x="${pad.left}" y="${height - 10}" fill="#59667a" font-size="11">${escapeHtml(date(points[0]!.date))}</text><text x="${width - pad.right}" y="${height - 10}" text-anchor="end" fill="#59667a" font-size="11">${escapeHtml(date(points.at(-1)!.date))}</text>
  </svg></div>`;
}

function latestPoint(series: WorkbookScoreSeries | null): WorkbookScorePoint | null {
  return series?.points.at(-1) ?? null;
}

export class ResearchTerminalController {
  private dashboard: ResearchTerminalDashboard | null = null;
  private strategyFilter = "all";
  private assetFilter = "all";
  private timeframeFilter = "all";
  private rangeDays: number | null = null;
  private publicationQuery = "";
  private publicationRegime = "all";
  private readonly terminalPage = Boolean(document.querySelector("[data-research-terminal-page]"));
  private readonly detailPage = Boolean(document.querySelector("[data-strategy-detail-page]"));

  constructor(private readonly onConnect: () => void) {
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const nav = target.closest<HTMLElement>("[data-rt-nav]");
      if (nav?.dataset.rtNav) this.showView(nav.dataset.rtNav);
      if (target.closest("[data-portfolio-connect]")) this.onConnect();
      if (target.closest("[data-rt-retry], [data-rt-refresh]")) void this.load();
      if (target.closest("[data-rt-menu]")) document.body.classList.toggle("is-menu-open");
    });
    document.querySelector<HTMLSelectElement>("[data-rt-strategy-filter]")?.addEventListener("change", (event) => {
      this.strategyFilter = (event.target as HTMLSelectElement).value;
      this.renderFilteredViews();
    });
    document.querySelector<HTMLSelectElement>("[data-rt-asset-filter]")?.addEventListener("change", (event) => {
      this.assetFilter = (event.target as HTMLSelectElement).value;
      this.renderFilteredViews();
    });
    document.querySelector<HTMLSelectElement>("[data-rt-timeframe-filter]")?.addEventListener("change", (event) => {
      this.timeframeFilter = (event.target as HTMLSelectElement).value;
      this.renderFilteredViews();
    });
    document.querySelector<HTMLSelectElement>("[data-rt-range-filter]")?.addEventListener("change", (event) => {
      const value = (event.target as HTMLSelectElement).value;
      this.rangeDays = value === "all" ? null : Number(value);
      this.renderFilteredViews();
    });
    document.querySelector<HTMLInputElement>("[data-rt-publication-search]")?.addEventListener("input", (event) => {
      this.publicationQuery = (event.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderPublications();
    });
    document.querySelector<HTMLSelectElement>("[data-rt-publication-regime]")?.addEventListener("change", (event) => {
      this.publicationRegime = (event.target as HTMLSelectElement).value;
      this.renderPublications();
    });
    window.addEventListener("hashchange", () => this.showView(location.hash.slice(1) || "overview"));
  }

  async updateSession(session: AuthSession): Promise<void> {
    if (!session.authenticated) {
      this.dashboard = null;
      this.show("gate");
      return;
    }
    await this.load();
  }

  private show(state: "gate" | "loading" | "workspace" | "error"): void {
    document.querySelector<HTMLElement>("[data-rt-gate]")?.toggleAttribute("hidden", state !== "gate");
    document.querySelector<HTMLElement>("[data-rt-loading]")?.toggleAttribute("hidden", state !== "loading");
    document.querySelector<HTMLElement>("[data-rt-workspace]")?.toggleAttribute("hidden", state !== "workspace");
    document.querySelector<HTMLElement>("[data-rt-strategy-detail]")?.toggleAttribute("hidden", state !== "workspace");
    document.querySelector<HTMLElement>("[data-rt-error]")?.toggleAttribute("hidden", state !== "error");
  }

  private async load(): Promise<void> {
    this.show("loading");
    try {
      this.dashboard = await apiRequest<ResearchTerminalDashboard>("/api/research-terminal", { signal: AbortSignal.timeout(20_000) });
      this.render();
      this.show("workspace");
    } catch (error) {
      if (error instanceof ClientApiError && error.code === "AUTH_REQUIRED") {
        this.show("gate");
        return;
      }
      const message = document.querySelector<HTMLElement>("[data-rt-error-message]");
      if (message) message.textContent = error instanceof Error ? error.message : "Research data could not be loaded.";
      this.show("error");
    }
  }

  private render(): void {
    if (!this.dashboard) return;
    const updated = document.querySelector<HTMLElement>("[data-rt-updated]");
    if (updated) updated.textContent = `Synchronized ${date(this.dashboard.generatedAt, true)} UTC`;
    const connectionTone = document.querySelector<HTMLElement>("[data-rt-connection-tone]");
    const ready = this.dashboard.connections.filter((connection) => connection.status === "ready").length;
    const partial = this.dashboard.connections.some((connection) => connection.status === "partial");
    connectionTone?.classList.toggle("is-ready", ready === this.dashboard.connections.length);
    connectionTone?.classList.toggle("is-partial", partial || (ready > 0 && ready < this.dashboard.connections.length));
    const connectionLabel = document.querySelector<HTMLElement>("[data-rt-connection-label]");
    if (connectionLabel) connectionLabel.textContent = `${ready}/${this.dashboard.connections.length} sources verified`;
    if (this.detailPage) this.renderStrategyDetail();
    else {
      this.populateFilters();
      this.renderOverview();
      this.renderFilteredViews();
      this.renderValuation();
      this.renderConnections();
      this.showView(location.hash.slice(1) || "overview");
    }
  }

  private populateFilters(): void {
    if (!this.dashboard) return;
    const options = (values: string[]) => [...new Set(values)].sort().map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    const strategy = document.querySelector<HTMLSelectElement>("[data-rt-strategy-filter]");
    const asset = document.querySelector<HTMLSelectElement>("[data-rt-asset-filter]");
    const timeframe = document.querySelector<HTMLSelectElement>("[data-rt-timeframe-filter]");
    if (strategy) strategy.innerHTML = `<option value="all">All strategies</option>${this.dashboard.strategies.map((item) => `<option value="${item.id}">${escapeHtml(item.displayName)}</option>`).join("")}`;
    if (asset) asset.innerHTML = `<option value="all">All assets</option>${options(this.dashboard.strategies.map((item) => item.asset))}`;
    if (timeframe) timeframe.innerHTML = `<option value="all">All timeframes</option>${options(this.dashboard.strategies.map((item) => item.timeframe))}`;
  }

  private filteredStrategies(): ResearchStrategy[] {
    if (!this.dashboard) return [];
    return this.dashboard.strategies.filter((strategy) =>
      (this.strategyFilter === "all" || strategy.id === this.strategyFilter) &&
      (this.assetFilter === "all" || strategy.asset === this.assetFilter) &&
      (this.timeframeFilter === "all" || strategy.timeframe === this.timeframeFilter)
    );
  }

  private filteredPoints(series: WorkbookScoreSeries | null): WorkbookScoreSeries | null {
    if (!series || !this.rangeDays || !series.points.length) return series;
    const cutoff = new Date(`${series.points.at(-1)!.date}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - this.rangeDays);
    return { ...series, points: series.points.filter((point) => new Date(`${point.date}T00:00:00Z`) >= cutoff) };
  }

  private renderOverview(): void {
    if (!this.dashboard) return;
    const latestObservation = this.dashboard.publications[0]?.observationDate ?? null;
    const forwardReady = this.dashboard.strategies.filter((strategy) => strategy.scoreHistory?.status === "ready").length;
    const readyConnections = this.dashboard.connections.filter((connection) => connection.status === "ready").length;
    setHtml("[data-rt-kpis]", [
      ["Published models", String(this.dashboard.workbook.signals.length), "Latest normalized score directory"],
      ["Tracked strategies", String(this.dashboard.strategies.length), "MTPI and Sniper V1"],
      ["Forward tests online", `${forwardReady}/${this.dashboard.strategies.length}`, "Populated dated histories only"],
      ["Latest observation", date(latestObservation), `${readyConnections}/${this.dashboard.connections.length} data sources verified`]
    ].map(([label, value, note]) => `<article class="rt-kpi"><span>${escapeHtml(label!)}</span><strong>${escapeHtml(value!)}</strong><small>${escapeHtml(note!)}</small></article>`).join(""));
    setHtml("[data-rt-latest-signals]", this.dashboard.workbook.signals.map((signal) => `<div class="rt-signal-row"><div><span>${escapeHtml(signal.name)}</span><small>${escapeHtml(signal.sourceTab ?? "Fallback snapshot")} · ${escapeHtml(signal.updatedLabel ?? "date unavailable")}</small></div><strong class="rt-score ${tone(signal.value)}">${score(signal.value)}</strong><b class="rt-status ${tone(signal.value)}">${escapeHtml(signal.state)}</b></div>`).join(""));
    setHtml("[data-rt-forward-summary]", this.dashboard.strategies.map((strategy) => {
      const series = strategy.scoreHistory;
      const latest = latestPoint(series);
      return `<div class="rt-forward-row"><div><span>${escapeHtml(strategy.displayName)}</span><small>${escapeHtml(series?.sourceTab ?? "Source unavailable")} · ${series?.points.length ?? 0} observations</small></div><strong class="${tone(latest?.score)}">${latest ? score(latest.score) : "Unavailable"}</strong></div>`;
    }).join(""));
    setHtml("[data-rt-recent-publications]", this.dashboard.publications.slice(0, 6).map((record) => `<div class="rt-publication-row"><time>${escapeHtml(date(record.observationDate))}</time><span>${escapeHtml(record.modelName)}<small>Observation date · publication time not separately recorded</small></span><strong class="${tone(record.score)}">${score(record.score)}</strong></div>`).join(""));
  }

  private renderFilteredViews(): void {
    if (!this.dashboard) return;
    const strategies = this.filteredStrategies();
    setHtml("[data-rt-strategy-table]", `<table class="rt-data-table"><thead><tr><th>Strategy</th><th>Portfolio value</th><th>Period return</th><th>Benchmark</th><th>Excess</th><th>Drawdown</th><th>Latest signal</th><th>Last update</th></tr></thead><tbody>${strategies.map((strategy) => `<tr><td><a href="strategy.html?strategy=${strategy.id}"><strong>${escapeHtml(strategy.displayName)} ${strategy.emblem ?? ""}</strong><small>${escapeHtml(strategy.asset)} · ${escapeHtml(strategy.timeframe)}</small></a></td><td class="rt-unavailable">Unavailable</td><td class="rt-unavailable">Unavailable</td><td class="rt-unavailable">Unavailable</td><td class="rt-unavailable">Unavailable</td><td class="rt-unavailable">Unavailable</td><td><strong class="${tone(strategy.signal?.value)}">${score(strategy.signal?.value)}</strong><small>${escapeHtml(strategy.signal?.state ?? "Unavailable")}</small></td><td>${escapeHtml(date(strategy.signal?.updatedLabel))}</td></tr>`).join("")}</tbody></table>`);
    setHtml("[data-rt-strategies]", strategies.map((strategy) => {
      const series = this.filteredPoints(strategy.scoreHistory);
      return `<article class="rt-strategy-card"><header><div><h3>${escapeHtml(strategy.displayName)}</h3><div class="rt-card-meta"><span>${escapeHtml(strategy.version)}</span><span>${escapeHtml(strategy.asset)}</span><span>${escapeHtml(strategy.timeframe)}</span><span>${escapeHtml(strategy.researchStatus.replace("_", " "))}</span></div></div>${strategy.emblem ? `<span class="rt-emblem" aria-label="Viper emblem">${strategy.emblem}</span>` : ""}</header><p>${escapeHtml(strategy.description)}</p>${miniChart(series)}<div class="rt-card-reading"><div><span>Current score</span><strong class="${tone(strategy.signal?.value)}">${score(strategy.signal?.value)}</strong></div><b class="rt-status ${tone(strategy.signal?.value)}">${escapeHtml(strategy.signal?.state ?? "Unavailable")}</b></div><div class="rt-card-meta">${strategy.originalSourceLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div><a class="rt-card-link" href="strategy.html?strategy=${strategy.id}">Open strategy research →</a></article>`;
    }).join("") || '<article class="rt-panel rt-detail-copy"><h3>No strategies match these filters.</h3><p>Reset the strategy, asset, or timeframe selection.</p></article>');
    this.renderModels();
    this.renderForwardTests();
    this.renderPublications();
  }

  private renderModels(): void {
    if (!this.dashboard) return;
    const strategyModelIds = new Set(this.filteredStrategies().map((strategy) => strategy.signal?.id).filter(Boolean));
    const signals = this.dashboard.workbook.signals.filter((signal) => this.strategyFilter === "all" || strategyModelIds.has(signal.id));
    setHtml("[data-rt-models]", signals.map((signal) => {
      const series = this.filteredPoints(this.dashboard!.workbook.scoreSeries.find((candidate) => candidate.id === signal.id) ?? null);
      return `<article class="rt-model-card"><header><div><h3>${escapeHtml(signal.name)}</h3><div class="rt-card-meta"><span>${escapeHtml(signal.sourceTab ?? "fallback")}</span><span>${escapeHtml(series?.sourceTab ?? "history unavailable")}</span></div></div><strong class="rt-score ${tone(signal.value)}">${score(signal.value)}</strong></header><p>${escapeHtml(signal.scope)}</p>${miniChart(series)}<div class="rt-card-reading"><span>${escapeHtml(signal.updatedLabel ?? "Publication date unavailable")}</span><b class="rt-status ${tone(signal.value)}">${escapeHtml(signal.state)}</b></div></article>`;
    }).join(""));
  }

  private renderForwardTests(): void {
    if (!this.dashboard) return;
    const strategyIds = new Set(this.filteredStrategies().map((strategy) => strategy.signal?.id).filter(Boolean));
    const series = this.dashboard.workbook.scoreSeries.filter((item) => this.strategyFilter === "all" || strategyIds.has(item.id));
    setHtml("[data-rt-forward-tests]", series.map((item) => {
      const filtered = this.filteredPoints(item)!;
      const first = filtered.points[0];
      const latest = filtered.points.at(-1);
      return `<article class="rt-forward-card"><header><div><h3>${escapeHtml(item.label)}</h3><div class="rt-card-meta"><span>${escapeHtml(item.sourceTab)}</span><span>Frozen observations</span></div></div><b class="rt-status ${item.status === "ready" ? "is-positive" : "is-warning"}">${escapeHtml(item.status)}</b></header><p>${escapeHtml(item.message ?? "Dated forward-test scores are preserved separately from historical backtests.")}</p>${miniChart(filtered)}<div class="rt-forward-stat"><div><span>Start</span><strong>${escapeHtml(date(first?.date))}</strong></div><div><span>Latest</span><strong>${escapeHtml(date(latest?.date))}</strong></div><div><span>Observations</span><strong>${filtered.points.length}</strong></div></div></article>`;
    }).join(""));
  }

  private filteredPublications(): PublishedScoreRecord[] {
    if (!this.dashboard) return [];
    const allowedModelIds = new Set(this.filteredStrategies().map((strategy) => strategy.signal?.id).filter(Boolean));
    let records = this.dashboard.publications.filter((record) => this.strategyFilter === "all" || allowedModelIds.has(record.modelId));
    if (this.rangeDays && records.length) {
      const cutoff = new Date(`${records[0]!.observationDate}T00:00:00Z`);
      cutoff.setUTCDate(cutoff.getUTCDate() - this.rangeDays);
      records = records.filter((record) => new Date(`${record.observationDate}T00:00:00Z`) >= cutoff);
    }
    return records.filter((record) =>
      (this.publicationRegime === "all" || record.regime === this.publicationRegime) &&
      (!this.publicationQuery || `${record.modelName} ${record.asset} ${record.timeframe}`.toLowerCase().includes(this.publicationQuery))
    );
  }

  private renderPublications(): void {
    const records = this.filteredPublications();
    setHtml("[data-rt-publications]", `<table class="rt-data-table"><thead><tr><th>Observation date</th><th>Publication time</th><th>Model / version</th><th>Asset</th><th>Timeframe</th><th>Score</th><th>Regime</th><th>Revision</th></tr></thead><tbody>${records.map((record) => `<tr><td>${escapeHtml(date(record.observationDate))}</td><td class="rt-unavailable">Not separately recorded</td><td><strong>${escapeHtml(record.modelName)}</strong><small>${escapeHtml(record.modelId)}</small></td><td>${escapeHtml(record.asset)}</td><td>${escapeHtml(record.timeframe)}</td><td><strong class="${tone(record.score)}">${score(record.score)}</strong></td><td><span class="rt-status ${tone(record.score)}">${escapeHtml(record.regime)}</span></td><td>v${record.revision}</td></tr>`).join("")}</tbody></table>${records.length ? "" : '<p class="rt-detail-copy">No published observations match the current filters.</p>'}`);
  }

  private renderValuation(): void {
    if (!this.dashboard) return;
    const valuation = this.dashboard.valuation;
    setHtml("[data-rt-valuations]", `<div class="rt-valuation-hero"><article class="rt-valuation-score"><span>Bitcoin composite valuation</span><strong>${score(valuation.score)}σ</strong><b>${escapeHtml(valuation.state ?? "Unavailable")}</b><small>Observation ${escapeHtml(date(valuation.workbookUpdatedLabel))}</small></article><article class="rt-valuation-context"><div class="rt-indicator-grid">${valuation.indicators.map((indicator) => `<div class="rt-indicator"><span>${escapeHtml(indicator.name)}</span><strong>${score(indicator.score)}σ</strong><small>${escapeHtml(indicator.categoryLabel)} · ${escapeHtml(indicator.state)}</small></div>`).join("") || '<p class="rt-unavailable">Verified valuation inputs unavailable.</p>'}</div><div class="rt-detail-copy"><h3>Methodology boundary</h3><p>The valuation workspace publishes the source reading and documented composite context. It does not infer a fair-value price, percentile, or valuation band that is not present in the connected source.</p></div></article></div>`);
  }

  private renderConnections(): void {
    if (!this.dashboard) return;
    setHtml("[data-rt-connections]", this.dashboard.connections.map((connection) => `<article class="rt-connection-card" data-status="${connection.status}"><header><div><h3>${escapeHtml(connection.name)}</h3><div class="rt-card-meta"><span>${escapeHtml(connection.provider)}</span><span>${escapeHtml(connection.access.replaceAll("_", " "))}</span></div></div><b class="rt-status ${statusTone(connection.status)}">${escapeHtml(connection.status)}</b></header><p>${escapeHtml(connection.message)}</p><div class="rt-connection-details"><div><span>Spreadsheet</span><strong>${escapeHtml(connection.spreadsheetId)}</strong></div><div><span>Latest observation</span><strong>${escapeHtml(date(connection.latestObservationDate))}</strong></div><div><span>Last successful sync</span><strong>${escapeHtml(date(connection.lastSuccessfulSync, true))}</strong></div><div><span>Source tabs</span><strong>${connection.sourceTabs.length}</strong></div></div></article>`).join(""));
    setHtml("[data-rt-mappings]", `<div class="rt-mapping-list">${this.dashboard.connections.flatMap((connection) => connection.mappedFields.map((field) => `<div class="rt-mapping-row"><strong>${escapeHtml(connection.name)}</strong><span>${escapeHtml(field)}</span><span>Normalized server-side from ${escapeHtml(connection.sourceTabs.join(", "))}</span></div>`)).join("")}</div>`);
    setHtml("[data-rt-unresolved]", `<div class="rt-unresolved-tags">${this.dashboard.unresolvedSourceLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div><div class="rt-detail-copy"><p>These labels remain intentionally unassigned until a source tab and field mapping establishes whether each represents a strategy, version, asset, timeframe, or portfolio total.</p></div>`);
  }

  private renderStrategyDetail(): void {
    if (!this.dashboard) return;
    const requested = new URLSearchParams(location.search).get("strategy") ?? "mtpi";
    const strategy = this.dashboard.strategies.find((candidate) => candidate.id === requested);
    const root = document.querySelector<HTMLElement>("[data-rt-strategy-detail]");
    if (!strategy || !root) {
      if (root) root.innerHTML = '<section class="rt-error"><h2>Strategy not found</h2><p>The requested strategy is not in the active mapping registry.</p></section>';
      return;
    }
    document.title = `${strategy.displayName} Research | AstravaQuant`;
    const title = document.querySelector<HTMLElement>("[data-rt-title]");
    if (title) title.textContent = `${strategy.displayName} research`;
    const records = this.dashboard.publications.filter((record) => record.strategyId === strategy.id).slice(0, 12);
    root.innerHTML = `<div class="rt-strategy-detail"><section class="rt-strategy-hero"><div><p>${escapeHtml(strategy.researchStatus.replace("_", " "))} · ${escapeHtml(strategy.version)}</p><h2>${escapeHtml(strategy.displayName)} ${strategy.emblem ?? ""}</h2><span>${escapeHtml(strategy.description)}</span><div class="rt-card-meta">${strategy.originalSourceLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div></div><div class="rt-strategy-reading"><strong class="${tone(strategy.signal?.value)}">${score(strategy.signal?.value)}</strong><span>${escapeHtml(strategy.signal?.state ?? "Unavailable")}</span><small>${escapeHtml(strategy.signal?.sourceTab ?? "Source unavailable")} · ${escapeHtml(date(strategy.signal?.updatedLabel))}</small></div></section><div class="rt-detail-metrics">${strategy.performanceMetrics.map((metric) => `<div class="rt-detail-metric"><span>${escapeHtml(metric.label)}</span><strong class="rt-unavailable">${escapeHtml(metric.value ?? "Unavailable")}</strong><small>${escapeHtml(metric.reason ?? "")}</small></div>`).join("")}</div><div class="rt-two-column"><article class="rt-panel rt-equity-panel"><header><div><p>Performance</p><h3>Equity curve versus buy and hold</h3></div></header><div class="rt-chart-unavailable"><div class="rt-chart-grid"></div><strong>Performance series unavailable</strong><span>${escapeHtml(strategy.performanceMessage)}</span></div></article><article class="rt-panel"><header><div><p>Forward validation</p><h3>Published score history</h3></div><span>${strategy.scoreHistory?.points.length ?? 0} observations</span></header>${fullScoreChart(strategy.scoreHistory)}</article></div><div class="rt-two-column"><article class="rt-panel rt-detail-copy"><h3>Rules summary</h3><p>${escapeHtml(strategy.rulesSummary)}</p><p><strong>Source tabs:</strong> ${escapeHtml(strategy.sourceTabs.join(" and "))}. Model formulas, thresholds, and source observations are not modified by this workspace.</p></article><article class="rt-panel rt-detail-copy"><h3>Research availability</h3><p><strong>Monthly return heatmap:</strong> Unavailable — no dated return series mapped.</p><p><strong>Trade or position history:</strong> Unavailable — no sufficient trade-level data mapped.</p><p><strong>Cost and slippage assumptions:</strong> Unavailable — not present in the normalized source.</p></article></div><article class="rt-panel rt-table-panel"><header><div><p>Evidence</p><h3>Recent published observations</h3></div><span>Publication time remains unavailable when not recorded separately</span></header><div class="rt-table-scroll"><table class="rt-data-table"><thead><tr><th>Observation date</th><th>Publication time</th><th>Score</th><th>Regime</th><th>Source</th><th>Revision</th></tr></thead><tbody>${records.map((record) => `<tr><td>${escapeHtml(date(record.observationDate))}</td><td class="rt-unavailable">Not separately recorded</td><td><strong class="${tone(record.score)}">${score(record.score)}</strong></td><td>${escapeHtml(record.regime)}</td><td>${escapeHtml(strategy.scoreHistory?.sourceTab ?? "Unavailable")}</td><td>v${record.revision}</td></tr>`).join("")}</tbody></table></div></article></div>`;
  }

  private showView(view: string): void {
    if (!this.terminalPage) return;
    const valid = ["overview", "strategies", "valuations", "models", "forward", "publications", "connections"];
    const selected = valid.includes(view) ? view : "overview";
    document.querySelectorAll<HTMLElement>("[data-rt-view]").forEach((section) => section.classList.toggle("is-active", section.dataset.rtView === selected));
    document.querySelectorAll<HTMLElement>("[data-rt-nav]").forEach((button) => button.classList.toggle("is-active", button.dataset.rtNav === selected));
    const labels: Record<string, string> = { overview: "Research overview", strategies: "Strategies", valuations: "Valuations", models: "Models & Signals", forward: "Forward Testing", publications: "Published Score History", connections: "Data Connections" };
    const title = document.querySelector<HTMLElement>("[data-rt-title]");
    if (title) title.textContent = labels[selected]!;
    if (location.hash !== `#${selected}`) history.replaceState(null, "", `#${selected}`);
    document.body.classList.remove("is-menu-open");
  }
}
