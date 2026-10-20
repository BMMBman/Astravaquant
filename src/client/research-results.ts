import type { WorkbookDashboard, WorkbookModelResults } from "../shared/contracts.js";
import { apiRequest } from "./api.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function render(root: HTMLElement, modelResults: WorkbookModelResults | undefined): void {
  if (!modelResults || modelResults.status !== "ready") {
    root.innerHTML = '<p class="aq-results-empty">The Model Results tab is currently unavailable. No substitute performance figures are shown.</p>';
    return;
  }
  const metrics = [
    ["Models", modelResults.modelCount?.toString() ?? "--"],
    ["Tests", modelResults.testCount?.toString() ?? "--"],
    ["Best net profit", modelResults.bestNetProfit ?? "--"],
    ["Best Sharpe", modelResults.bestSharpe ?? "--"],
    ["Best profit factor", modelResults.bestProfitFactor ?? "--"],
    ["Review flags", modelResults.reviewFlags?.toString() ?? "--"]
  ];
  root.innerHTML = `<div class="aq-results-summary">
    ${metrics.map(([label, value]) => `<div><span>${escapeHtml(label!)}</span><strong>${escapeHtml(value!)}</strong></div>`).join("")}
  </div>
  <div class="aq-results-table-wrap">
    <table class="aq-results-table">
      <thead><tr><th>Model</th><th>Window</th><th>Start</th><th>Net profit</th><th>Max DD</th><th>Profit factor</th><th>Sharpe</th><th>Trades</th><th>Review</th></tr></thead>
      <tbody>${modelResults.results.map((result) => `<tr>
        <td><strong>${escapeHtml(result.model)}</strong><small>${escapeHtml(result.timeframe)}</small></td>
        <td>${escapeHtml(result.window)}</td><td>${escapeHtml(result.startDate)}</td><td>${escapeHtml(result.netProfit)}</td>
        <td>${escapeHtml(result.maxEquityDrawdown)}</td><td>${escapeHtml(result.profitFactor)}</td><td>${escapeHtml(result.sharpe)}</td>
        <td>${escapeHtml(result.trades)}</td><td><span class="aq-review-status" data-status="${escapeHtml(result.reviewStatus.toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(result.reviewStatus)}</span></td>
      </tr>`).join("")}</tbody>
    </table>
  </div>
  <footer class="aq-results-disclosure"><strong>As of ${escapeHtml(modelResults.asOf ?? "latest publication")}</strong><span>${escapeHtml(modelResults.disclosure)}</span><small>Source: ${modelResults.sourceTab}. Backtests are not live trading results and do not predict future performance.</small></footer>`;
}

export async function bootResearchResults(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-model-results]");
  if (!root) return;
  try {
    const dashboard = await apiRequest<WorkbookDashboard>("/api/workbook", { signal: AbortSignal.timeout(12_000) });
    render(root, dashboard.modelResults);
  } catch {
    root.innerHTML = '<p class="aq-results-empty">The live Model Results tab could not be reached. No substitute performance figures are shown.</p>';
  }
}
