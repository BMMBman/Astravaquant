import {
  connect,
  createConfig,
  disconnect,
  getConnections,
  getConnectors,
  http,
  reconnect,
  signMessage,
  watchConnections,
  type Config,
  type Connector
} from "@wagmi/core";
import { arbitrum, base, mainnet } from "@wagmi/core/chains";
import { coinbaseWallet, walletConnect } from "@wagmi/connectors";
import type { AuthSession, PublicConfig } from "../shared/contracts.js";
import { apiRequest, ClientApiError } from "./api.js";
import { trackProductEvent } from "./analytics.js";
import { escapeHtml, shortenAddress } from "./format.js";

type SessionListener = (session: AuthSession) => void;

const publicChains = [mainnet, base, arbitrum] as const;

function disconnectedSession(): AuthSession {
  return {
    authenticated: false,
    address: null,
    chainId: null,
    network: null,
    accessTier: "public",
    expiresAt: null
  };
}

function connectorLabel(connector: Connector): string {
  if (connector.id === "walletConnect") return "WalletConnect";
  if (connector.id.toLowerCase().includes("coinbase")) return "Coinbase Wallet";
  return connector.name || "Browser Wallet";
}

function connectorBrand(connector: Connector): "coinbase" | "metamask" | "walletconnect" | "keplr" | "browser" {
  const identity = `${connector.id} ${connector.name}`.toLowerCase();
  if (identity.includes("coinbase")) return "coinbase";
  if (identity.includes("metamask")) return "metamask";
  if (identity.includes("walletconnect")) return "walletconnect";
  if (identity.includes("keplr")) return "keplr";
  return "browser";
}

function connectorDescription(connector: Connector): string {
  const brand = connectorBrand(connector);
  if (brand === "coinbase") return "Coinbase Wallet or Smart Wallet";
  if (brand === "walletconnect") return "Scan with a compatible mobile wallet";
  if (brand === "keplr") return "Connect a compatible EVM account";
  return "Connect the installed browser wallet";
}

function safeConnectorIcon(connector: Connector): string | null {
  const icon = connector.icon?.trim();
  if (!icon) return null;
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(icon)) {
    return icon;
  }
  return null;
}

function fallbackWalletLogo(brand: ReturnType<typeof connectorBrand>): string {
  if (brand === "coinbase") {
    return `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1652f0" />
        <circle cx="16" cy="16" r="9.2" fill="#fff" />
        <rect x="12" y="12" width="8" height="8" rx="2.1" fill="#1652f0" />
      </svg>
    `;
  }
  if (brand === "metamask") {
    return `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4.5 4.2 13.2 10l-2 4.8-6.7-3.1z" fill="#e2761b" />
        <path d="m27.5 4.2-8.7 5.8 2 4.8 6.7-3.1z" fill="#e2761b" />
        <path d="m6.3 12.1 5.1 2.5-1.2 8.7-4-1.2z" fill="#f6851b" />
        <path d="m25.7 12.1-5.1 2.5 1.2 8.7 4-1.2z" fill="#f6851b" />
        <path d="m11.4 14.6 4.6 2.2 4.6-2.2 1.2 8.7-5.8 4-5.8-4z" fill="#cd6116" />
        <path d="m12.6 22.3 3.4 1.5 3.4-1.5-1.2 3.1h-4.4z" fill="#f7b27a" />
        <path d="m12.4 16.6 2.5 1.2-1.6 1.5zM19.6 16.6l-2.5 1.2 1.6 1.5z" fill="#fff" />
      </svg>
    `;
  }
  if (brand === "walletconnect") {
    return `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#3b99fc" />
        <path d="M7.2 13.2c4.9-4.7 12.7-4.7 17.6 0l1.1 1.1-2.2 2.1-1.1-1.1a9.4 9.4 0 0 0-13.2 0l-1.1 1.1-2.2-2.1zm3.9 3.8a6.9 6.9 0 0 1 9.8 0l1.2 1.1-2.2 2.1-1.1-1.1a3.9 3.9 0 0 0-5.6 0l-1.1 1.1-2.2-2.1z" fill="#fff" />
      </svg>
    `;
  }
  if (brand === "keplr") {
    return `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="keplr-wallet-gradient" x1="5" y1="4" x2="28" y2="29" gradientUnits="userSpaceOnUse">
            <stop stop-color="#9d7bff" />
            <stop offset="1" stop-color="#4d38d8" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#keplr-wallet-gradient)" />
        <path d="M10 7.5v17M21.8 8.5l-8.1 7.3 8.8 7.7" fill="none" stroke="#fff" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#111923" />
      <path d="M7.5 11.2h17v12.3h-17z" fill="none" stroke="#a7cae8" stroke-width="1.6" />
      <path d="M10.2 11.2V8.7h10.4v2.5M20 17.3h4.5" fill="none" stroke="#e8cf9d" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="20" cy="17.3" r="1" fill="#e8cf9d" />
    </svg>
  `;
}

function connectorMark(connector: Connector): string {
  const brand = connectorBrand(connector);
  const icon = safeConnectorIcon(connector);
  const content = icon
    ? `<img src="${escapeHtml(icon)}" alt="" loading="eager" />`
    : fallbackWalletLogo(brand);
  return `<span class="wallet-provider-mark wallet-provider-mark-${brand}" aria-hidden="true">${content}</span>`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ClientApiError) return error.message;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("rejected") || message.includes("denied") || message.includes("cancelled")) {
    return "Wallet connection or signature was declined. Nothing was changed.";
  }
  if (message.includes("chain") || message.includes("network")) {
    return "Switch to Ethereum, Base, or Arbitrum to continue.";
  }
  return "The wallet could not be connected. Please try again.";
}

function analyticsError(error: unknown): string {
  if (error instanceof ClientApiError) return error.code.toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : "unknown";
  if (message.includes("rejected") || message.includes("denied") || message.includes("cancelled")) return "user_rejected";
  if (message.includes("chain") || message.includes("network")) return "unsupported_network";
  return "connection_failed";
}

export class WalletController {
  private readonly config: Config;
  private readonly listeners = new Set<SessionListener>();
  private session: AuthSession;
  private busy = false;
  private accountMenuOpen = false;
  private readonly dialog: HTMLDialogElement;
  private readonly toast: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly publicConfig: PublicConfig,
    initialSession: AuthSession
  ) {
    const connectors = [
      coinbaseWallet({ appName: "AstravaQuant", preference: { options: "eoaOnly" } }),
      ...(publicConfig.walletConnectProjectId
        ? [
            walletConnect({
              projectId: publicConfig.walletConnectProjectId,
              showQrModal: true,
              metadata: {
                name: "AstravaQuant",
                description: "Read-only market research and portfolio intelligence",
                url: window.location.origin,
                icons: []
              }
            })
          ]
        : [])
    ];

    this.config = createConfig({
      chains: publicChains,
      connectors,
      multiInjectedProviderDiscovery: true,
      transports: {
        [mainnet.id]: http(),
        [base.id]: http(),
        [arbitrum.id]: http()
      }
    });
    this.session = initialSession;
    this.dialog = document.createElement("dialog");
    this.dialog.className = "wallet-dialog";
    this.toast = document.createElement("div");
    this.toast.className = "wallet-toast";
    this.toast.setAttribute("role", "status");
    document.body.append(this.dialog, this.toast);
    this.bindRoot();
    this.render();
  }

  async initialize(): Promise<void> {
    try {
      await reconnect(this.config);
    } catch {
      // A stale wallet connector must not invalidate a valid server session.
    }

    watchConnections(this.config, {
      onChange: (connections) => {
        const connection = connections[0];
        if (
          this.session.authenticated &&
          connection &&
          (connection.accounts[0]?.toLowerCase() !== this.session.address?.toLowerCase() ||
            connection.chainId !== this.session.chainId)
        ) {
          void this.logout(false);
          this.showToast("Wallet account changed. Authenticate the new account to continue.");
        }
        this.render();
      }
    });
    this.render();
  }

  onSessionChange(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.session);
    return () => this.listeners.delete(listener);
  }

  openConnect(): void {
    trackProductEvent("wallet_modal_opened");
    this.renderDialog();
    this.dialog.showModal();
  }

  private emitSession(): void {
    for (const listener of this.listeners) listener(this.session);
  }

  private setSession(session: AuthSession): void {
    this.session = session;
    this.emitSession();
    this.render();
  }

  private bindRoot(): void {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-wallet-connect]")) {
        this.openConnect();
      }
      if (target.closest("[data-wallet-account]")) {
        this.accountMenuOpen = !this.accountMenuOpen;
        this.render();
      }
      if (target.closest("[data-wallet-logout]")) {
        void this.logout(true);
      }
    });

    this.dialog.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target === this.dialog || target.closest("[data-wallet-close]")) {
        this.dialog.close();
        return;
      }
      const connectorButton = target.closest<HTMLElement>("[data-connector-uid]");
      if (connectorButton?.dataset.connectorUid) {
        void this.connectConnector(connectorButton.dataset.connectorUid);
      }
    });
  }

  private render(): void {
    if (this.session.authenticated && this.session.address) {
      this.root.innerHTML = `
        <div class="wallet-account-wrap">
          <button class="wallet-account-button" type="button" data-wallet-account aria-expanded="${this.accountMenuOpen}">
            <span class="wallet-status-dot" aria-hidden="true"></span>
            <span>${escapeHtml(shortenAddress(this.session.address))}</span>
            <span class="wallet-chevron" aria-hidden="true"></span>
          </button>
          <div class="wallet-account-menu" ${this.accountMenuOpen ? "" : "hidden"}>
            <span class="wallet-menu-label">Authenticated wallet</span>
            <strong>${escapeHtml(shortenAddress(this.session.address))}</strong>
            <span>${escapeHtml(this.session.network ?? "Network")}</span>
            <span class="wallet-readonly-pill">Read-only session</span>
            <a href="portfolio.html">Open portfolio</a>
            <button type="button" data-wallet-logout>Disconnect</button>
          </div>
        </div>
      `;
      return;
    }

    this.root.innerHTML = `
      <button class="button wallet-connect-button" type="button" data-wallet-connect ${this.busy ? "disabled" : ""}>
        ${this.busy ? "Connecting..." : "Connect Wallet"}
      </button>
    `;
  }

  private renderDialog(): void {
    const connectors = getConnectors(this.config);
    const unique = new Map<string, Connector>();
    for (const connector of connectors) {
      const label = connectorLabel(connector);
      if (!unique.has(label)) unique.set(label, connector);
    }

    const buttons = [...unique.values()]
      .map(
        (connector) => `
          <button class="wallet-provider" type="button" data-connector-uid="${escapeHtml(connector.uid)}">
            ${connectorMark(connector)}
            <span><strong>${escapeHtml(connectorLabel(connector))}</strong><small>${escapeHtml(connectorDescription(connector))}</small></span>
            <span class="wallet-provider-arrow" aria-hidden="true">
              <svg viewBox="0 0 18 18"><path d="M3.5 9h10M10 5.5 13.5 9 10 12.5" /></svg>
            </span>
          </button>
        `
      )
      .join("");

    this.dialog.innerHTML = `
      <div class="wallet-dialog-card">
        <button class="wallet-dialog-close" type="button" data-wallet-close aria-label="Close wallet connection">&times;</button>
        <span class="table-label">Wallet identity</span>
        <h2>Connect to personalize AstravaQuant.</h2>
        <p>Choose a wallet, then sign one authentication message. This proves wallet ownership without creating a transaction.</p>
        <div class="wallet-provider-list">
          ${buttons || '<p class="wallet-dialog-empty">No compatible wallet connector is available in this browser.</p>'}
        </div>
        <div class="wallet-safety-note">
          <strong>No transactions. No custody.</strong>
          <span>AstravaQuant never asks for a seed phrase, private key, token approval, deposit, or withdrawal.</span>
        </div>
      </div>
    `;
  }

  private async connectConnector(uid: string): Promise<void> {
    if (this.busy) return;
    const connector = getConnectors(this.config).find((candidate) => candidate.uid === uid);
    if (!connector) {
      this.showToast("That wallet connector is no longer available.");
      return;
    }

    this.busy = true;
    const provider = connectorBrand(connector);
    trackProductEvent("wallet_connect_started", { provider });
    this.dialog.close();
    this.render();

    try {
      const result = await connect(this.config, { connector });
      const address = result.accounts[0];
      if (!address) throw new Error("Wallet returned no account.");
      if (!this.publicConfig.supportedChains.some((chain) => chain.id === result.chainId)) {
        throw new ClientApiError("UNSUPPORTED_NETWORK", "Switch to Ethereum, Base, or Arbitrum to continue.", 400);
      }

      const nonce = await apiRequest<{ message: string; expiresAt: string }>("/api/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ address, chainId: result.chainId })
      });
      const signature = await signMessage(this.config, {
        account: address,
        connector,
        message: nonce.message
      });
      const session = await apiRequest<AuthSession>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ message: nonce.message, signature })
      });
      this.setSession(session);
      trackProductEvent("wallet_auth_succeeded", { provider, chain_id: result.chainId });
      this.showToast("Wallet authenticated. Portfolio access is read-only.");
    } catch (error) {
      trackProductEvent("wallet_auth_failed", { provider, reason: analyticsError(error) });
      this.showToast(errorMessage(error));
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async logout(showConfirmation: boolean): Promise<void> {
    try {
      await apiRequest<AuthSession>("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // Local disconnect still proceeds if the server session already expired.
    }

    const connections = getConnections(this.config);
    await Promise.allSettled(connections.map((connection) => disconnect(this.config, { connector: connection.connector })));
    this.accountMenuOpen = false;
    this.setSession(disconnectedSession());
    trackProductEvent("wallet_disconnected");
    if (showConfirmation) this.showToast("Wallet disconnected from AstravaQuant.");
  }

  private showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add("is-visible");
    window.setTimeout(() => this.toast.classList.remove("is-visible"), 4200);
  }
}
