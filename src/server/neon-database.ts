import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { AccessTier, PerformancePoint } from "../shared/contracts.js";
import type {
  AstravaDataStore,
  NonceRecord,
  SessionRecord,
  WalletIdentity
} from "./database.js";

type TimestampValue = Date | string;

interface NeonNonceRow extends Omit<NonceRecord, "expires_at" | "used_at"> {
  expires_at: TimestampValue;
  used_at: TimestampValue | null;
}

interface NeonSessionRow {
  id: string;
  user_id: string;
  wallet_id: string;
  address: string;
  chain_id: number;
  access_tier: AccessTier;
  expires_at: TimestampValue;
}

function isoTimestamp(value: TimestampValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class NeonAstravaDatabase implements AstravaDataStore {
  private readonly sql;
  private readonly ready: Promise<void>;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
    this.ready = this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.sql.transaction((transaction) => [
      transaction`SELECT pg_advisory_xact_lock(hashtext('astravaquant_schema_v1'))`,
      transaction`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          primary_address TEXT NOT NULL UNIQUE,
          access_tier TEXT NOT NULL DEFAULT 'authenticated'
            CHECK (access_tier IN ('public', 'authenticated', 'premium')),
          created_at TIMESTAMPTZ NOT NULL,
          last_login_at TIMESTAMPTZ NOT NULL
        )
      `,
      transaction`
        CREATE TABLE IF NOT EXISTS wallets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          address TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          label TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          last_connected_at TIMESTAMPTZ NOT NULL,
          UNIQUE(address, chain_id)
        )
      `,
      transaction`CREATE INDEX IF NOT EXISTS wallets_address_idx ON wallets(address)`,
      transaction`
        CREATE TABLE IF NOT EXISTS auth_nonces (
          id TEXT PRIMARY KEY,
          nonce_hash TEXT NOT NULL UNIQUE,
          address TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          domain TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ
        )
      `,
      transaction`CREATE INDEX IF NOT EXISTS auth_nonces_expiry_idx ON auth_nonces(expires_at)`,
      transaction`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ
        )
      `,
      transaction`CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash)`,
      transaction`CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`,
      transaction`
        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
          id TEXT PRIMARY KEY,
          wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
          chain_id INTEGER NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          total_value_usd DOUBLE PRECISION NOT NULL CHECK(total_value_usd >= 0)
        )
      `,
      transaction`
        CREATE INDEX IF NOT EXISTS portfolio_snapshots_lookup_idx
        ON portfolio_snapshots(wallet_id, chain_id, timestamp)
      `
    ]);
  }

  async createNonce(input: {
    nonceHash: string;
    address: string;
    chainId: number;
    domain: string;
    expiresAt: string;
  }): Promise<void> {
    await this.ready;
    await this.sql`
      INSERT INTO auth_nonces
        (id, nonce_hash, address, chain_id, domain, created_at, expires_at)
      VALUES (
        ${randomUUID()},
        ${input.nonceHash},
        ${input.address.toLowerCase()},
        ${input.chainId},
        ${input.domain},
        ${new Date().toISOString()},
        ${input.expiresAt}
      )
    `;
  }

  async findNonce(nonceHash: string): Promise<NonceRecord | null> {
    await this.ready;
    const rows = await this.sql`
      SELECT id, nonce_hash, address, chain_id, domain, expires_at, used_at
      FROM auth_nonces
      WHERE nonce_hash = ${nonceHash}
      LIMIT 1
    ` as NeonNonceRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      expires_at: isoTimestamp(row.expires_at),
      used_at: row.used_at ? isoTimestamp(row.used_at) : null
    };
  }

  async consumeNonce(id: string): Promise<boolean> {
    await this.ready;
    const rows = await this.sql`
      UPDATE auth_nonces
      SET used_at = NOW()
      WHERE id = ${id} AND used_at IS NULL AND expires_at > NOW()
      RETURNING id
    `;
    return rows.length === 1;
  }

  async upsertWallet(address: string, chainId: number): Promise<WalletIdentity> {
    await this.ready;
    const normalizedAddress = address.toLowerCase();
    const now = new Date().toISOString();
    const users = await this.sql`
      INSERT INTO users (id, primary_address, access_tier, created_at, last_login_at)
      VALUES (${randomUUID()}, ${normalizedAddress}, 'authenticated', ${now}, ${now})
      ON CONFLICT (primary_address)
      DO UPDATE SET last_login_at = EXCLUDED.last_login_at
      RETURNING id, access_tier
    ` as Array<{ id: string; access_tier: AccessTier }>;
    const user = users[0];
    if (!user) throw new Error("Could not create the wallet identity.");

    const wallets = await this.sql`
      INSERT INTO wallets (id, user_id, address, chain_id, created_at, last_connected_at)
      VALUES (${randomUUID()}, ${user.id}, ${normalizedAddress}, ${chainId}, ${now}, ${now})
      ON CONFLICT (address, chain_id)
      DO UPDATE SET last_connected_at = EXCLUDED.last_connected_at
      RETURNING id, user_id
    ` as Array<{ id: string; user_id: string }>;
    const wallet = wallets[0];
    if (!wallet) throw new Error("Could not store the connected wallet.");

    return {
      userId: wallet.user_id,
      walletId: wallet.id,
      accessTier: user.access_tier
    };
  }

  async createSession(input: {
    userId: string;
    walletId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<void> {
    await this.ready;
    await this.sql`
      INSERT INTO sessions (id, user_id, wallet_id, token_hash, created_at, expires_at)
      VALUES (
        ${randomUUID()},
        ${input.userId},
        ${input.walletId},
        ${input.tokenHash},
        ${new Date().toISOString()},
        ${input.expiresAt}
      )
    `;
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    await this.ready;
    const rows = await this.sql`
      SELECT
        sessions.id,
        sessions.user_id,
        sessions.wallet_id,
        wallets.address,
        wallets.chain_id,
        users.access_tier,
        sessions.expires_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      JOIN wallets ON wallets.id = sessions.wallet_id
      WHERE sessions.token_hash = ${tokenHash}
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > NOW()
      LIMIT 1
    ` as NeonSessionRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      address: row.address,
      chainId: Number(row.chain_id),
      accessTier: row.access_tier,
      expiresAt: isoTimestamp(row.expires_at)
    };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.ready;
    await this.sql`
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
    `;
  }

  async recordSnapshot(input: {
    walletId: string;
    chainId: number;
    totalValueUsd: number;
    minimumIntervalMs: number;
  }): Promise<void> {
    await this.ready;
    await this.sql`
      INSERT INTO portfolio_snapshots (id, wallet_id, chain_id, timestamp, total_value_usd)
      SELECT ${randomUUID()}, ${input.walletId}, ${input.chainId}, NOW(), ${input.totalValueUsd}
      WHERE NOT EXISTS (
        SELECT 1
        FROM portfolio_snapshots
        WHERE wallet_id = ${input.walletId}
          AND chain_id = ${input.chainId}
          AND timestamp > NOW() - (${input.minimumIntervalMs} * INTERVAL '1 millisecond')
      )
    `;
  }

  async getSnapshots(walletId: string, chainId: number): Promise<PerformancePoint[]> {
    await this.ready;
    const rows = await this.sql`
      SELECT timestamp, total_value_usd
      FROM portfolio_snapshots
      WHERE wallet_id = ${walletId} AND chain_id = ${chainId}
      ORDER BY timestamp ASC
    ` as Array<{ timestamp: TimestampValue; total_value_usd: number | string }>;
    return rows.map((row) => ({
      timestamp: isoTimestamp(row.timestamp),
      valueUsd: Number(row.total_value_usd)
    }));
  }

  async cleanup(): Promise<void> {
    await this.ready;
    await this.sql.transaction((transaction) => [
      transaction`DELETE FROM auth_nonces WHERE expires_at <= NOW() OR used_at IS NOT NULL`,
      transaction`DELETE FROM sessions WHERE expires_at <= NOW() OR revoked_at IS NOT NULL`
    ]);
  }

  close(): void {
    // Neon HTTP connections are request-scoped and require no explicit shutdown.
  }
}
