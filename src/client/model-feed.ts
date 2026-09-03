import type { BitcoinValuationDashboard, WorkbookDashboard, WorkbookModelSignal, WorkbookRatioModel } from "../shared/contracts.js";
import { apiRequest } from "./api.js";
import { renderModelHistory, renderModelHistoryUnavailable } from "./model-history.js";

function signed(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}`;
  return value.toFixed(2);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function tone(signal: WorkbookModelSignal): "good" | "warn" | "bad" | "neutral" {
  if (signal.id === "mrpi") {
    if (signal.value <= -0.75) return "bad";
    if (signal.value < -0.25) return "warn";
    if (signal.value <= 0.25) return "neutral";
    return "good";
  }
  if (signal.value <= -0.75) return "bad";
  if (signal.value < -0.25) return "warn";
  if (signal.value <= 0.25) return "neutral";
  return "good";
}

function updateSignal(signal: WorkbookModelSignal): void {
  const signalTone = tone(signal);
  document.querySelectorAll<HTMLElement>(`[data-model-id="${signal.id}"]`).forEach((root) => {
    root.querySelectorAll<HTMLElement>("[data-model-value]").forEach((node) => {
      node.textContent = signed(signal.value);
    });
    root.querySelectorAll<HTMLElement>("[data-model-state]").forEach((node) => {
      node.textContent = signal.state;
      node.classList.remove("status-good", "status-warn", "status-bad", "status-neutral");
      node.classList.add(`status-${signalTone}`);
    });
    root.querySelectorAll<HTMLElement>("[data-model-regime]").forEach((node) => {
      node.textContent = signal.id === "mrpi" ? signal.state : signal.regime;
    });
    root.querySelectorAll<HTMLElement>("[data-model-source]").forEach((node) => {
      node.textContent = signal.source === "google_sheets"
        ? `${signal.sourceTab} / ${signal.updatedLabel ?? "live workbook"}`
        : signal.source === "derived"
          ? "Derived from MTPI + LTPI"
          : "Manual fallback";
    });
    root.querySelectorAll<HTMLElement>("[data-model-updated]").forEach((node) => {
      node.textContent = signal.updatedLabel ?? (signal.source === "derived" ? "Derived model" : "Manual fallback");
    });
    const dial = root.querySelector<HTMLElement>("[data-dial-value]");
    if (dial) {
      dial.dataset.dialValue = String(signal.value);
      dial.dataset.dialTone = signalTone;
      window.dispatchEvent(new CustomEvent("astrava:model-updated", { detail: { element: dial } }));
    }
  });
}

function updatePublication(dashboard: WorkbookDashboard): void {
  document.querySelectorAll<HTMLElement>("[data-model-publication]").forEach((root) => {
    const title = root.querySelector<HTMLElement>("[data-publication-title]");
    const message = root.querySelector<HTMLElement>("[data-publication-message]");
    const status = root.querySelector<HTMLElement>("[data-publication-status]");
    if (dashboard.status === "ready" || dashboard.status === "partial") {
      if (title) title.textContent = dashboard.status === "ready" ? "Live Google Sheets feed" : "Live feed / partial coverage";
      const mrpiLive = dashboard.mrpiSystem?.status === "ready" || dashboard.mrpiSystem?.status === "partial";
      if (message) message.textContent = mrpiLive
        ? `Crypto and MRPI workbooks validated every ${dashboard.refreshSeconds / 60} minutes.`
        : `Crypto workbook validated every ${dashboard.refreshSeconds / 60} minutes. MRPI feed delayed.`;
      if (status) status.textContent = dashboard.status === "ready" ? "15 / 15 crypto tabs online" : `${dashboard.tabs.filter((tab) => tab.status === "ready").length} / 15 crypto tabs online`;
      root.dataset.state = dashboard.status;
    } else {
      if (title) title.textContent = "Manual fallback snapshot";
      if (message) message.textContent = "The research workbook connection is pending; existing published values remain visible.";
      if (status) status.textContent = "Workbook offline";
      root.dataset.state = "unavailable";
    }
  });
}

function rotationTone(model: WorkbookRatioModel): "positive" | "negative" | "neutral" {
  if (model.score > 0.25) return "positive";
  if (model.score < -0.25) return "negative";
  return "neutral";
}

function updateRatios(dashboard: WorkbookDashboard): void {
  const root = document.querySelector<HTMLElement>("[data-rotation-board]");
  const leaderRoot = document.querySelector<HTMLElement>("[data-rotation-leader]");
  if (!root) return;
  const models = [...new Map(dashboard.ratioModels.map((model) => [model.id, model])).values()]
    .sort((left, right) => right.score - left.score);
  if (!models.length) {
    root.insertAdjacentHTML("beforeend", '<p class="aq-disclosure aq-ratio-unavailable">The live ratio-model feed is temporarily unavailable. The catalog remains visible; no substitute scores are shown.</p>');
    if (leaderRoot) leaderRoot.innerHTML = "<span>Current leader</span><strong>Unavailable</strong>";
    return;
  }

  root.innerHTML = models.map((model, index) => {
    const position = Math.min(100, Math.max(0, ((model.score + 1) / 2) * 100));
    const tone = rotationTone(model);
    return `<article class="aq-grid-card aq-ratio-card" data-tone="${tone}">
      <div class="aq-ratio-head"><span>${String(index + 1).padStart(2, "0")} / ${escapeHtml(model.sourceTab)}</span><b>${escapeHtml(model.state)}</b></div>
      <h3>${escapeHtml(model.label)}</h3>
      <div class="aq-ratio-reading"><strong>${signed(model.score)}</strong><span>Relative-strength score</span></div>
      <div class="aq-ratio-rail" aria-label="${escapeHtml(model.label)} relative-strength score ${signed(model.score)}"><i></i><b style="left:${position.toFixed(1)}%"></b></div>
      <footer class="aq-ratio-scale"><span>Weak</span><span>Neutral</span><span>Strong</span></footer>
    </article>`;
  }).join("");

  const leader = models[0]!;
  if (leaderRoot) leaderRoot.innerHTML = `<span>Current leader</span><strong>${escapeHtml(leader.label)} <b>${signed(leader.score)}</b></strong>`;
}

function valuationScore(value: number | null): string {
  if (value === null) return "--";
  return `${signed(value)}\u03c3`;
}

function valuationDate(value: string | null): string {
  if (!value) return "Verified dates only";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function renderValuationBrief(dashboard: BitcoinValuationDashboard): void {
  const root = document.querySelector<HTMLElement>("[data-valuation-brief]");
  if (!root) return;
  root.dataset.state = dashboard.status;
  const score = root.querySelector<HTMLElement>("[data-valuation-brief-score]");
  const state = root.querySelector<HTMLElement>("[data-valuation-brief-state]");
  const date = root.querySelector<HTMLElement>("[data-valuation-brief-date]");
  const status = root.querySelector<HTMLElement>("[data-valuation-brief-status]");
  const inputCount = root.querySelector<HTMLElement>("[data-valuation-brief-inputs]");
  const marker = root.querySelector<HTMLElement>("[data-valuation-brief-marker]");
  const markerLabel = root.querySelector<HTMLElement>("[data-valuation-brief-marker-label]");
  if (score) score.textContent = valuationScore(dashboard.score);
  if (state) state.textContent = dashboard.state?.toUpperCase() ?? "UNAVAILABLE";
  if (date) date.textContent = `As of ${valuationDate(dashboard.workbookUpdatedLabel)}`;
  if (status) {
    status.textContent = dashboard.status === "ready" ? "Live workbook" : dashboard.status === "partial" ? "Partial workbook" : "Feed unavailable";
    status.classList.toggle("is-unavailable", dashboard.status === "unavailable");
  }
  if (inputCount) inputCount.textContent = dashboard.indicatorCount
    ? `${dashboard.indicatorCount} verified input${dashboard.indicatorCount === 1 ? "" : "s"}`
    : "Verified inputs unavailable";
  if (marker && dashboard.score !== null) {
    const clamped = Math.min(dashboard.scaleMax, Math.max(dashboard.scaleMin, dashboard.score));
    const position = ((clamped - dashboard.scaleMin) / (dashboard.scaleMax - dashboard.scaleMin)) * 100;
    marker.style.setProperty("--valuation-position", "50%");
    requestAnimationFrame(() => requestAnimationFrame(() => marker.style.setProperty("--valuation-position", `${position.toFixed(2)}%`)));
  }
  if (markerLabel) markerLabel.textContent = valuationScore(dashboard.score);
}

function renderValuationBriefUnavailable(): void {
  const root = document.querySelector<HTMLElement>("[data-valuation-brief]");
  if (!root) return;
  root.dataset.state = "unavailable";
  const status = root.querySelector<HTMLElement>("[data-valuation-brief-status]");
  const state = root.querySelector<HTMLElement>("[data-valuation-brief-state]");
  if (status) {
    status.textContent = "Feed unavailable";
    status.classList.add("is-unavailable");
  }
  if (state) state.textContent = "NO SUBSTITUTE SCORE";
}

export async function bootModelFeed(): Promise<void> {
  const workbookTask = apiRequest<WorkbookDashboard>("/api/workbook", { signal: AbortSignal.timeout(12_000) })
    .then((dashboard) => {
      renderModelHistory(dashboard);
      dashboard.signals.forEach(updateSignal);
      updatePublication(dashboard);
      updateRatios(dashboard);
    })
    .catch(() => {
      const unavailable: WorkbookDashboard = { status: "unavailable", provider: null, updatedAt: new Date().toISOString(), refreshSeconds: 300, signals: [], scoreSeries: [], ratioModels: [], tabs: [], warnings: [] };
      updatePublication(unavailable);
      updateRatios(unavailable);
      renderModelHistoryUnavailable();
    });

  const valuationTask = document.querySelector("[data-valuation-brief]")
    ? apiRequest<BitcoinValuationDashboard>("/api/valuation", { signal: AbortSignal.timeout(12_000) })
        .then(renderValuationBrief)
        .catch(renderValuationBriefUnavailable)
    : Promise.resolve();

  await Promise.allSettled([workbookTask, valuationTask]);
}
