import type { WorkbookModelSignal, WorkbookSignalSnapshot } from "../shared/contracts.js";
import { apiRequest } from "./api.js";

const minimumRefreshMs = 60_000;
let lastUpdatedAt = 0;
let refreshTimer: number | null = null;
let activeRequest: Promise<void> | null = null;
let hasRendered = false;

function signed(value: number): string {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function signalTone(signal: WorkbookModelSignal): "good" | "warn" | "bad" | "neutral" {
  if (signal.id === "mrpi") {
    if (signal.value <= -0.5) return "bad";
    if (signal.value < -0.1) return "warn";
    return signal.value > 0.1 ? "good" : "neutral";
  }
  if (signal.value <= -0.75) return "bad";
  if (signal.value < -0.25) return "warn";
  if (signal.value <= 0.25) return "neutral";
  return "good";
}

function setFeedState(state: "loading" | "refreshing" | "ready" | "unavailable"): void {
  document.querySelectorAll<HTMLElement>(".hero-metric[data-model-id]").forEach((root) => {
    root.dataset.feedState = state;
    root.setAttribute("aria-busy", String(state === "loading" || state === "refreshing"));
    if (state === "unavailable" && !hasRendered) {
      const value = root.querySelector<HTMLElement>("[data-model-value]");
      const label = root.querySelector<HTMLElement>("[data-model-state]");
      if (value) value.textContent = "--";
      if (label) {
        label.textContent = "Feed delayed";
        label.classList.remove("status-good", "status-warn", "status-bad");
        label.classList.add("status-neutral");
      }
    }
  });
}

function renderSignal(signal: WorkbookModelSignal): void {
  const tone = signalTone(signal);
  document.querySelectorAll<HTMLElement>(`[data-model-id="${signal.id}"]`).forEach((root) => {
    const value = root.querySelector<HTMLElement>("[data-model-value]");
    const state = root.querySelector<HTMLElement>("[data-model-state]");
    if (value) value.textContent = signed(signal.value);
    if (state) {
      state.textContent = signal.state;
      state.classList.remove("status-good", "status-warn", "status-bad", "status-neutral");
      state.classList.add(`status-${tone}`);
    }
  });
}

function scheduleRefresh(refreshSeconds: number): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  const delay = Math.max(minimumRefreshMs, refreshSeconds * 1000);
  refreshTimer = window.setTimeout(() => void refreshSignals(), delay);
}

function refreshSignals(): Promise<void> {
  if (activeRequest) return activeRequest;
  setFeedState(hasRendered ? "refreshing" : "loading");
  activeRequest = apiRequest<WorkbookSignalSnapshot>("/api/signals", {
    signal: AbortSignal.timeout(8_000)
  }).then((snapshot) => {
    snapshot.signals.forEach(renderSignal);
    hasRendered = snapshot.signals.length > 0;
    lastUpdatedAt = Date.now();
    setFeedState(hasRendered ? "ready" : "unavailable");
    scheduleRefresh(snapshot.refreshSeconds);
  }).catch(() => {
    setFeedState("unavailable");
    scheduleRefresh(60);
  }).finally(() => {
    activeRequest = null;
  });
  return activeRequest;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastUpdatedAt >= minimumRefreshMs) {
    void refreshSignals();
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted && Date.now() - lastUpdatedAt >= minimumRefreshMs) void refreshSignals();
});

void refreshSignals();
