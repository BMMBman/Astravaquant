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
            <span class="wallet-chevron" aria-hidden="true">⌄</span>
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
            <span class="wallet-provider-mark" aria-hidden="true"></span>
            <span><strong>${escapeHtml(connectorLabel(connector))}</strong><small>Connect and sign a read-only login message</small></span>
            <span aria-hidden="true">→</span>
          </button>
        `
      )
      .join("");

    this.dialog.innerHTML = `
      <div class="wallet-dialog-card">
        <button class="wallet-dialog-close" type="button" data-wallet-close aria-label="Close wallet connection">×</button>
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
      this.showToast("Wallet authenticated. Portfolio access is read-only.");
    } catch (error) {
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
    if (showConfirmation) this.showToast("Wallet disconnected from AstravaQuant.");
  }

  private showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add("is-visible");
    window.setTimeout(() => this.toast.classList.remove("is-visible"), 4200);
  }
}
