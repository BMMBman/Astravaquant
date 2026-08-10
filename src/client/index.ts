import type { AuthSession, PublicConfig } from "../shared/contracts.js";
import { apiRequest } from "./api.js";
import { PortfolioController } from "./portfolio.js";
import type { WalletController } from "./wallet.js";

async function boot(): Promise<void> {
  const walletRoot = document.querySelector<HTMLElement>("[data-wallet-root]");
  if (!walletRoot) return;
  const root = walletRoot;

  const staticPreview = document.querySelector<HTMLElement>("[data-static-preview]");
  if (staticPreview) staticPreview.hidden = true;

  let publicConfig: PublicConfig | null = null;
  let session: AuthSession | null = null;
  let walletPromise: Promise<WalletController> | null = null;
  const portfolio = document.querySelector<HTMLElement>("[data-portfolio-page]")
    ? new PortfolioController(() => void openWallet())
    : null;
  const bootstrapPromise = Promise.all([
    apiRequest<PublicConfig>("/api/config"),
    apiRequest<AuthSession>("/api/auth/session")
  ]).then(([nextConfig, nextSession]) => {
    publicConfig = nextConfig;
    session = nextSession;
    return nextSession;
  });

  const loadWallet = (): Promise<WalletController> => {
    if (!publicConfig || !session) {
      return Promise.reject(new Error("Wallet service is not ready."));
    }
    if (!walletPromise) {
      walletPromise = import("./wallet.js").then(async ({ WalletController }) => {
        const wallet = new WalletController(root, publicConfig!, session!);
        wallet.onSessionChange((nextSession) => {
          session = nextSession;
          if (portfolio) void portfolio.updateSession(nextSession);
        });
        await wallet.initialize();
        return wallet;
      });
    }
    return walletPromise;
  };

  async function openWallet(): Promise<void> {
    const bootstrapButton = root.querySelector<HTMLButtonElement>("[data-wallet-bootstrap]");
    if (bootstrapButton) {
      bootstrapButton.disabled = true;
      bootstrapButton.textContent = "Opening wallet...";
    }
    try {
      if (!publicConfig || !session) await bootstrapPromise;
      const wallet = await loadWallet();
      wallet.openConnect();
    } catch {
      if (bootstrapButton) {
        bootstrapButton.disabled = true;
        bootstrapButton.textContent = "Wallet service offline";
      }
    }
  }

  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-wallet-bootstrap]")) void openWallet();
  });

  try {
    session = await bootstrapPromise;
    if (portfolio) await portfolio.updateSession(session);
    if (session.authenticated) await loadWallet();
  } catch {
    root.innerHTML = '<button class="button wallet-connect-button" type="button" disabled>Wallet service offline</button>';
    const portfolioButton = document.querySelector<HTMLButtonElement>("[data-portfolio-connect]");
    if (portfolioButton) {
      portfolioButton.disabled = true;
      portfolioButton.textContent = "Wallet service offline";
    }
    const gateMessage = document.querySelector<HTMLElement>("[data-portfolio-gate-message]");
    if (gateMessage) {
      gateMessage.textContent = "The research page is ready, but wallet authentication needs the AstravaQuant application server.";
    }
  }
}

void boot();
