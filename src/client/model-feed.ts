import type { WorkbookDashboard, WorkbookModelSignal } from "../shared/contracts.js";
import { apiRequest } from "./api.js";

function signed(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}`;
  return value.toFixed(2);
}

function tone(signal: WorkbookModelSignal): "good" | "warn" | "bad" | "neutral" {
  if (signal.id === "mrpi") return signal.value < -0.5 ? "bad" : signal.value > 0.25 ? "good" : "neutral";
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
      if (message) message.textContent = `Validated every ${dashboard.refreshSeconds / 60} minutes. MRPI remains separately published.`;
      if (status) status.textContent = dashboard.status === "ready" ? "15 / 15 tabs online" : `${dashboard.tabs.filter((tab) => tab.status === "ready").length} / 15 tabs online`;
      root.dataset.state = dashboard.status;
    } else {
      if (title) title.textContent = "Manual fallback snapshot";
      if (message) message.textContent = "The research workbook connection is pending; existing published values remain visible.";
      if (status) status.textContent = "Workbook offline";
      root.dataset.state = "unavailable";
    }
  });
}

function updateRatios(dashboard: WorkbookDashboard): void {
  for (const model of dashboard.ratioModels) {
    document.querySelectorAll<HTMLElement>(`[data-ratio-id="${model.id}"]`).forEach((root) => {
      const value = root.querySelector<HTMLElement>("[data-ratio-value]");
      const state = root.querySelector<HTMLElement>("[data-ratio-state]");
      const summary = root.querySelector<HTMLElement>("[data-ratio-summary]");
      if (value) value.textContent = signed(model.score);
      if (state) state.textContent = model.state;
      if (summary) summary.textContent = `Current normalized reading from ${model.sourceTab}. Historical ratio prices are not supplied by this tab.`;
      const dial = root.querySelector<HTMLElement>("[data-dial-value]");
      if (dial) {
        dial.dataset.dialValue = String(model.score);
        dial.dataset.dialTone = model.score > 0.25 ? "good" : model.score < -0.25 ? "bad" : "neutral";
        window.dispatchEvent(new CustomEvent("astrava:model-updated", { detail: { element: dial } }));
      }
    });
  }
}

export async function bootModelFeed(): Promise<void> {
  try {
    const dashboard = await apiRequest<WorkbookDashboard>("/api/workbook");
    dashboard.signals.forEach(updateSignal);
    updatePublication(dashboard);
    updateRatios(dashboard);
  } catch {
    updatePublication({ status: "unavailable", provider: null, updatedAt: new Date().toISOString(), refreshSeconds: 300, signals: [], scoreSeries: [], ratioModels: [], tabs: [], warnings: [] });
  }
}
