import { inject, track } from "@vercel/analytics";

export type ProductEventName =
  | "wallet_modal_opened"
  | "wallet_connect_started"
  | "wallet_auth_succeeded"
  | "wallet_auth_failed"
  | "wallet_disconnected"
  | "portfolio_dashboard_loaded"
  | "portfolio_dashboard_failed"
  | "terminal_data_loaded"
  | "terminal_data_failed"
  | "research_opened";

const sensitiveKey = /address|wallet|balance|holding|value|signature|message|nonce|token/i;

function analyticsEnabled(): boolean {
  return window.location.protocol === "https:";
}

export function initializeAnalytics(): void {
  if (!analyticsEnabled()) return;
  inject({
    debug: false,
    beforeSend(event) {
      const url = new URL(event.url, window.location.origin);
      return { ...event, url: `${url.origin}${url.pathname}` };
    }
  });

  document.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("research-") || href.includes("buildthebrief.com")) {
      trackProductEvent("research_opened", {
        destination: href.includes("buildthebrief.com") ? "build-the-brief" : href.replace(".html", "")
      });
    }
  });
}

export function trackProductEvent(
  name: ProductEventName,
  properties: Record<string, string | number | boolean | null | undefined> = {}
): void {
  if (!analyticsEnabled()) return;
  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !sensitiveKey.test(key))
  );
  track(name, safeProperties);
}
