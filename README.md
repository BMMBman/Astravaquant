# AstravaQuant

AstravaQuant is a systematic research and portfolio intelligence platform for crypto, liquidity, housing, macro, and mortgage-rate pressure.

**AstravaQuant wallet integrations are currently read-only and non-custodial. AstravaQuant does not execute blockchain transactions or control user assets.**

## Architecture

The original project was a static multi-page site with shared `styles.css` and `app.js`. This milestone preserves that structure and adds:

- Vite as the multi-page frontend build system.
- A small TypeScript wallet client built with Wagmi Core, Viem, WalletConnect, Coinbase Wallet, and EIP-6963 injected-wallet discovery.
- An Express API for SIWE authentication, sessions, portfolio retrieval, snapshots, and personalized research, published as one Vercel Function in production.
- A shared persistence boundary backed by SQLite locally and durable Neon Postgres on Vercel.
- A server-only GoldRush portfolio provider behind the `PortfolioProvider` interface.
- A cached public-market provider for CoinGecko crypto data, CoinPaprika current-data fallback, DefiLlama stablecoins, and Federal Reserve Economic Data series.
- A server-only Google Sheets provider that normalizes all 15 research tabs through a read-only public export or optional service account.
- A separate read-only Bitcoin valuation provider that verifies a 17-input standard-deviation composite and its forward-testing history.
- A model-lab page for verified score history, regime distributions, threshold testing, and transition diagnostics.
- Vercel Web Analytics with a client-side privacy filter that excludes wallet and portfolio properties.

Public pages include the homepage, models, backtesting, terminal, research library, individual research notes, methodology, privacy, and terms. The legacy Signals route redirects to Models, which owns current model state and history. The portfolio API requires an authenticated wallet session. The access middleware already supports `public`, `authenticated`, and `premium` tiers; no payment or token-gating system is implemented.

There was no deployment configuration or existing backend, database, authentication system, or live model API in the repository before this milestone. `src/server/data/astrava.ts` now acts only as the disclosed fallback when the research workbook cannot be verified.

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

## Market Terminal

`GET /api/markets` serves a normalized market dashboard contract. `PublicMarketProvider` retrieves:

- Total crypto market capitalization, crypto market capitalization excluding Bitcoin, and tracked crypto assets from CoinGecko, with CoinPaprika as a read-only current-data fallback.
- The 10-year Treasury (`DGS10`), Federal Reserve assets (`WALCL`), Treasury General Account (`WTREGEN`), overnight reverse repo (`RRPONTSYD`), M2 (`M2SL`), S&P 500 (`SP500`), Nasdaq Composite (`NASDAQCOM`), mortgage rates, and home prices from FRED.
- Aggregate USD stablecoin supply and history from DefiLlama.
- Fed net liquidity derived as `WALCL - WTREGEN - (RRPONTSYD * 1,000)` after normalizing all inputs to millions of U.S. dollars.

Provider requests run independently and time out cleanly, so one failed series does not blank the dashboard. Responses are cached for five minutes by default. Global crypto market-cap history is not fabricated when it is unavailable from the public feed; TOTAL and TOTAL2 remain current-snapshot cards while BTC, ETH, and FRED series include sourced history.

## Research Workbook And Backtesting

`GET /api/workbook` reads the link-shared AstravaQuant workbook through Google's read-only CSV export. If the workbook is made private again, the provider can instead use Google's official authentication client with the `spreadsheets.readonly` OAuth scope. Optional service-account credentials stay server-side and are never returned to the browser.

The provider batch-reads and validates all 15 tabs: Command Center, RSPS, Alts RSPS, MTPI, LTPI, both forward-testing tabs, BTC, ETH, SOL, HYPE, SUI, Others.D TPI, ALT Selection Table, and Trash Tournament. The public response contains normalized scores, dated score observations, tab health, and formula-error counts rather than raw cells.

MTPI and LTPI are sourced from their workbook summaries when available. NSPI is transparently derived as the mean of the two published readings. MRPI is not present in this crypto workbook and remains the separate manual reading. If Google is unavailable, the app keeps the existing fallback snapshot visible and labels the workbook offline.

The Backtesting page analyzes only dated scores that exist in the connected forward-testing tabs. It supports MTPI, LTPI, derived NSPI, and the Bitcoin valuation composite with scale-specific thresholds, distributions, streaks, and transitions. A first dated valuation observation is shown as a verified tracking point; the historical line forms automatically after another scored date is published. It does not calculate returns, alpha, Sharpe, or drawdown because the current workbooks do not contain an aligned investable benchmark series. Those statistics remain disabled until real price history is supplied.

## Bitcoin Valuation Workbook

`GET /api/valuation` reads bounded ranges from the link-shared Bitcoin valuation workbook set by `VALUATION_GOOGLE_SHEETS_ID`. The provider validates all indicator scores, recomputes their arithmetic mean, compares it with the published composite, and caches the normalized result server-side for five minutes by default.

The primary score follows the workbook's orientation: positive standard deviations represent greater modeled value and negative standard deviations represent lower modeled value. The workbook's score multiplied by `-1` is shown separately as an inverse risk lens. Neither score is presented as a dollar fair-value target.

Fundamental, technical, and sentiment category averages are calculated from the available input rows. Forward-testing history appears only after the workbook contains at least two real dated score observations; the application does not generate or backfill historical values.

## Environment

Copy `.env.example` to `.env` and configure:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Exact public origin used for browser-origin and SIWE domain validation. Use HTTPS in production. |
| `PORT` | Express API port. |
| `SESSION_SECRET` | Server-only secret of at least 32 random characters. Required in production. |
| `SESSION_TTL_HOURS` | Authenticated session lifetime. |
| `DATABASE_PATH` | Persistent SQLite file path. |
| `DATABASE_URL` | Server-only Neon Postgres URL. Required for the Vercel wallet service. |
| `WALLETCONNECT_PROJECT_ID` | Public Reown project ID that enables WalletConnect. |
| `GOLDRUSH_API_KEY` | Server-only GoldRush portfolio API key. |
| `PORTFOLIO_CACHE_SECONDS` | Short server-side holdings cache duration. |
| `COINGECKO_API_KEY` | Optional server-only CoinGecko demo key. The keyless public endpoint is used when omitted. |
| `MARKET_CACHE_SECONDS` | Server-side terminal feed cache duration. |
| `GOOGLE_SHEETS_ID` | Private AstravaQuant spreadsheet ID. |
| `VALUATION_GOOGLE_SHEETS_ID` | Link-shared Bitcoin valuation workbook ID. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Optional server-only service-account email when the workbook is private. |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Optional server-only PEM private key; provide it with the email as a pair. |
| `GOOGLE_SHEETS_CACHE_SECONDS` | Server-side normalized workbook cache duration. |
| `ETHEREUM_RPC_URL` | Optional server RPC for Ethereum smart-account signature verification. |
| `BASE_RPC_URL` | Optional server RPC for Base smart-account signature verification. |
| `ARBITRUM_RPC_URL` | Optional server RPC for Arbitrum smart-account signature verification. |

Never commit `.env` or real secrets. Production serves the built frontend and `/api` from the same origin. `vercel.json` sends every `/api/*` request to one Express function, while Neon supplies durable nonce, session, wallet, and snapshot state across function invocations.

## Local Development

Node 24+ and pnpm 10.28 are required.

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

## Vercel Deployment

The Vercel project requires these production variables before the wallet service can start:

- `APP_URL=https://www.astravaquant.com/`
- `SESSION_SECRET` set to a generated value of at least 32 characters
- `DATABASE_URL` injected by the connected Neon integration

`WALLETCONNECT_PROJECT_ID` enables WalletConnect QR sessions, and `GOLDRUSH_API_KEY` enables live indexed portfolio balances. The service remains non-custodial with or without those optional providers.

`GOLDRUSH_API_KEY` is still required before production can return live wallet holdings. Without it, authentication works and the portfolio dashboard returns a deliberate provider-unavailable state rather than mock data.

The link-shared workbook needs only `GOOGLE_SHEETS_ID`; the AstravaQuant workbook ID is the project default. If access is restricted later, enable the Google Sheets API, create a service account, share the workbook with its email as Viewer, and provide both optional service-account variables together.

The catch-all function is `api/handler.ts`. It creates the Postgres schema idempotently on cold start and delegates the original `/api/*` path to the existing Express application. Vercel function secrets remain server-side.

## Data Model

SQLite is migrated on local server startup, and Neon Postgres is migrated when the Vercel Function initializes. Both stores use these tables:

- `users`: identity, access tier, creation, and last login.
- `wallets`: user relationship, normalized public address, chain ID, optional label, and connection timestamps.
- `auth_nonces`: keyed nonce hash, bound address, chain, domain, expiration, and one-time use timestamp.
- `sessions`: keyed opaque-token hash, user, wallet, expiration, and revocation timestamp.
- `portfolio_snapshots`: wallet, chain, timestamp, and total USD value.

No private keys, seed phrases, signing keys, token approvals, or unnecessary transaction history are stored.

## Security Assumptions

- Production runs behind HTTPS with `APP_URL` set to the exact public origin.
- `SESSION_SECRET` is generated securely and stored only in the deployment secret manager.
- Production uses durable, access-controlled Neon Postgres; SQLite is limited to local development or a persistent Node host.
- GoldRush and RPC credentials are server-only.
- The deployment uses a shared rate-limit store if it scales to multiple API instances.
- Content Security Policy, origin validation, custom request headers, HttpOnly cookies, nonce expiration, replay protection, and server signature verification remain enabled.
- Dependency updates and changes to wallet/authentication code receive security review and run `pnpm check` before deployment.

## Analytics

Vercel Web Analytics is initialized only on HTTPS deployments. Page URLs are stripped of query strings and fragments before collection. Custom product events cover wallet-modal opens, categorized connection outcomes, terminal feed status, portfolio dashboard status, and research opens. The analytics helper rejects property keys related to wallet addresses, balances, holdings, values, signatures, nonces, messages, or tokens. Availability of custom-event reporting depends on the Vercel project plan; anonymous pageview analytics can operate independently.

## Model Publication

The public model register is `AQ Core v0.2`. Current crypto readings and existing forward-test observations are normalized from the link-shared research workbook every five minutes. No missing dates, ratio histories, benchmark prices, or performance statistics are backfilled. Workbook cell errors are reported as unavailable rather than coerced to zero. See `methodology.html` for inputs, scales, derivations, and limitations.

## Visual Sources

The live homepage globe uses NASA/Goddard Space Flight Center Scientific Visualization Studio Blue Marble imagery. The optimized project texture is derived from the NASA SVS equirectangular Earth visualization (ID 3615) and also powers the CSS fallback when WebGL is unavailable.
