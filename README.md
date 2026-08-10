# AstravaQuant

AstravaQuant is a systematic research and portfolio intelligence platform for crypto, liquidity, housing, macro, and mortgage-rate pressure.

**AstravaQuant wallet integrations are currently read-only and non-custodial. AstravaQuant does not execute blockchain transactions or control user assets.**

## Architecture

The original project was a static multi-page site with shared `styles.css` and `app.js`. This milestone preserves that structure and adds:

- Vite as the multi-page frontend build system.
- A small TypeScript wallet client built with Wagmi Core, Viem, WalletConnect, Coinbase Wallet, and EIP-6963 injected-wallet discovery.
- An Express API for SIWE authentication, sessions, portfolio retrieval, snapshots, and personalized research.
- A mature SQLite database driver for users, wallets, nonces, sessions, and portfolio snapshots.
- A server-only GoldRush portfolio provider behind the `PortfolioProvider` interface.

Current pages are `index.html`, `models.html`, `terminal.html`, and `portfolio.html`. Public research remains available without wallet authentication. The portfolio API requires an authenticated wallet session. The access middleware already supports `public`, `authenticated`, and `premium` tiers; no payment or token-gating system is implemented.

There was no deployment configuration or existing backend, database, authentication system, or live model API in the repository before this milestone. Model values remain the existing AstravaQuant values in `src/server/data/astrava.ts`.

## Wallet Authentication

The authentication flow is:

1. The browser connects to an EVM wallet through Wagmi.
2. `POST /api/auth/nonce` validates the address and chain, creates a cryptographically random five-minute nonce, stores only its keyed hash, and returns a complete EIP-4361 message.
3. The wallet signs that human-readable authentication message.
4. `POST /api/auth/verify` validates the message domain, URI, scheme, address, chain, nonce, expiration, and signature on the server.
5. The nonce is atomically consumed and cannot be replayed.
6. The server stores only a hash of the new opaque session token and sets the token in an HttpOnly cookie.

Signatures are used only to prove wallet ownership. The client contains no transaction, contract-writing, asset-approval, deposit, withdrawal, or transfer actions.

Sessions expire after `SESSION_TTL_HOURS` and are revoked on logout. State-changing authentication routes require the exact configured browser origin plus the `X-Astrava-Request` header. API routes are rate-limited and all input is validated.

## Portfolio Data

`GoldRushPortfolioProvider` retrieves indexed, read-only token balances and USD quotes from GoldRush's server API. The API key never reaches the browser. Provider output is normalized into an internal contract so another portfolio provider can replace GoldRush without changing the dashboard.

Supported networks in the first milestone are:

- Ethereum mainnet (`1`)
- Base (`8453`)
- Arbitrum One (`42161`)

24-hour changes are displayed only when the provider supplies a valid prior valuation. Historical performance is never fabricated. AstravaQuant records a real total-value snapshot at most once every 15 minutes after an authenticated portfolio is successfully retrieved. Period charts become available only when enough recorded history exists.

The current AstravaQuant model does not publish target portfolio weights. The dashboard therefore shows the user's real allocation and an explicit `Not published` model state. Add real target weights before enabling allocation differences.

## Environment

Copy `.env.example` to `.env` and configure:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Exact public origin used for browser-origin and SIWE domain validation. Use HTTPS in production. |
| `PORT` | Express API port. |
| `SESSION_SECRET` | Server-only secret of at least 32 random characters. Required in production. |
| `SESSION_TTL_HOURS` | Authenticated session lifetime. |
| `DATABASE_PATH` | Persistent SQLite file path. |
| `WALLETCONNECT_PROJECT_ID` | Public Reown project ID that enables WalletConnect. |
| `GOLDRUSH_API_KEY` | Server-only GoldRush portfolio API key. |
| `PORTFOLIO_CACHE_SECONDS` | Short server-side holdings cache duration. |
| `ETHEREUM_RPC_URL` | Optional server RPC for Ethereum smart-account signature verification. |
| `BASE_RPC_URL` | Optional server RPC for Base smart-account signature verification. |
| `ARBITRUM_RPC_URL` | Optional server RPC for Arbitrum smart-account signature verification. |

Never commit `.env` or real secrets. In production, serve the built frontend and `/api` from the same origin. Use a Node 24+ host with persistent storage mounted at `DATABASE_PATH`; a static-only host such as GitHub Pages cannot run the authentication API.

## Local Development

Node 24+ and pnpm 11+ are required.

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

The web app runs at `http://localhost:5173` and proxies `/api` to `http://localhost:3000`.

Run the full verification suite:

```powershell
pnpm check
```

Create and run the production build:

```powershell
pnpm build
pnpm start
```

## Add an EVM Network

Add the chain in all three chain-aware locations:

1. Add its chain definition to `src/client/wallet.ts` and its public transport to the Wagmi config.
2. Add its ID, display name, and GoldRush chain slug to `supportedChains` in `src/server/config.ts`.
3. Add an optional server RPC environment variable and map it in `loadConfig` for smart-account SIWE verification.

Then add authentication and provider tests for the new chain before release.

## Data Model

SQLite is migrated on server startup with these tables:

- `users`: identity, access tier, creation, and last login.
- `wallets`: user relationship, normalized public address, chain ID, optional label, and connection timestamps.
- `auth_nonces`: keyed nonce hash, bound address, chain, domain, expiration, and one-time use timestamp.
- `sessions`: keyed opaque-token hash, user, wallet, expiration, and revocation timestamp.
- `portfolio_snapshots`: wallet, chain, timestamp, and total USD value.

No private keys, seed phrases, signing keys, token approvals, or unnecessary transaction history are stored.

## Security Assumptions

- Production runs behind HTTPS with `APP_URL` set to the exact public origin.
- `SESSION_SECRET` is generated securely and stored only in the deployment secret manager.
- The SQLite database is on persistent, access-controlled storage and is backed up.
- GoldRush and RPC credentials are server-only.
- The deployment uses a shared rate-limit store if it scales to multiple API instances.
- Content Security Policy, origin validation, custom request headers, HttpOnly cookies, nonce expiration, replay protection, and server signature verification remain enabled.
- Dependency updates and changes to wallet/authentication code receive security review and run `pnpm check` before deployment.

## Visual Sources

The live homepage globe uses NASA/Goddard Space Flight Center Scientific Visualization Studio Blue Marble imagery. The optimized project texture is derived from the NASA SVS equirectangular Earth visualization (ID 3615); the generated orbital still is used only as a graceful no-WebGL fallback.
