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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function renderGauge(root: HTMLElement, value: number, tone: "good" | "warn" | "bad" | "neutral"): void {
  const clamped = Math.max(-1, Math.min(1, value));
  const angle = Math.PI - ((clamped + 1) / 2) * Math.PI;
  const x = 90 + 64 * Math.cos(angle);
  const y = 88 - 64 * Math.sin(angle);
  const color = tone === "good" ? "#95b8a6" : tone === "bad" ? "#d9857b" : tone === "warn" ? "#c8a66e" : "#9ba3ad";
  root.innerHTML = `<svg viewBox="0 0 180 104"><path d="M26 88A64 64 0 0 1 154 88" fill="none" stroke="rgba(241,236,226,.14)" stroke-width="7"/><path d="M26 88A64 64 0 0 1 154 88" fill="none" stroke="${color}" stroke-width="3" pathLength="1" stroke-dasharray="${((clamped + 1) / 2).toFixed(3)} 1"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${color}" stroke="#111216" stroke-width="2"/><text x="90" y="78" text-anchor="middle" fill="#f1ece2" font-size="23" font-family="Georgia, serif">${signed(value)}</text><text x="26" y="102" fill="#8f8d88" font-size="8">-1</text><text x="90" y="102" text-anchor="middle" fill="#8f8d88" font-size="8">0</text><text x="154" y="102" text-anchor="end" fill="#8f8d88" font-size="8">+1</text></svg>`;
}

function normalizedPublicationDate(snapshot: WorkbookSignalSnapshot): string {
  const publishedDates = snapshot.signals
    .map((signal) => signal.updatedLabel?.trim() ?? "")
    .map((value) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    })
    .filter((value): value is string => Boolean(value))
    .sort();

  return publishedDates.at(-1) ?? snapshot.updatedAt;
}

function setSummaryState(state: "loading" | "refreshing" | "ready" | "unavailable", label?: string): void {
  const root = document.querySelector<HTMLElement>("[data-home-summary-status]");
  if (!root) return;
  root.dataset.state = state === "ready" ? "ready" : state === "unavailable" ? "unavailable" : "loading";
  const copy = root.querySelector<HTMLElement>("[data-model-summary-date]");
  if (copy) {
    copy.textContent = label
      ?? (state === "unavailable" ? "Published state temporarily unavailable" : "Connecting research workbook");
  }
}

function setFeedState(state: "loading" | "refreshing" | "ready" | "unavailable"): void {
  document.querySelectorAll<HTMLElement>("[data-model-id]").forEach((root) => {
    root.dataset.feedState = state;
    root.setAttribute("aria-busy", String(state === "loading" || state === "refreshing"));
    if (state === "unavailable" && !hasRendered) {
      const value = root.querySelector<HTMLElement>("[data-model-value]");
      const label = root.querySelector<HTMLElement>("[data-model-state]");
      const updated = root.querySelector<HTMLElement>("[data-model-updated]");
      if (value) value.textContent = "--";
      if (label) {
        label.textContent = "Feed delayed";
        label.classList.remove("status-good", "status-warn", "status-bad");
        label.classList.add("status-neutral");
      }
      if (updated) updated.textContent = "Awaiting workbook";
    }
  });
  setSummaryState(state);
}

function renderSignal(signal: WorkbookModelSignal): void {
  const tone = signalTone(signal);
  document.querySelectorAll<HTMLElement>(`[data-model-id="${signal.id}"]`).forEach((root) => {
    const value = root.querySelector<HTMLElement>("[data-model-value]");
    const state = root.querySelector<HTMLElement>("[data-model-state]");
    const updated = root.querySelector<HTMLElement>("[data-model-updated]");
    if (value) value.textContent = signed(signal.value);
    if (state) {
      state.textContent = signal.state;
      state.classList.remove("status-good", "status-warn", "status-bad", "status-neutral");
      state.classList.add(`status-${tone}`);
    }
    if (updated) {
      updated.textContent = signal.updatedLabel ?? "Published fallback";
    }
    const gauge = root.querySelector<HTMLElement>("[data-home-gauge]");
    if (gauge) renderGauge(gauge, signal.value, tone);
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
    setSummaryState(
      hasRendered ? "ready" : "unavailable",
      hasRendered ? `As of ${formatDate(normalizedPublicationDate(snapshot))}` : "Published state temporarily unavailable"
    );
    scheduleRefresh(snapshot.refreshSeconds);
  }).catch(() => {
    setFeedState("unavailable");
    setSummaryState("unavailable");
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
