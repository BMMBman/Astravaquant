import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { AccessTier, PerformancePoint } from "../shared/contracts.js";

export interface NonceRecord {
  id: string;
  nonce_hash: string;
  address: string;
  chain_id: number;
  domain: string;
  expires_at: string;
  used_at: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  wallet_id: string;
  address: string;
  chain_id: number;
  access_tier: AccessTier;
  expires_at: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  walletId: string;
  address: string;
  chainId: number;
  accessTier: AccessTier;
  expiresAt: string;
}

export interface WalletIdentity {
  userId: string;
  walletId: string;
  accessTier: AccessTier;
}

type Awaitable<T> = T | Promise<T>;

export interface AstravaDataStore {
  createNonce(input: {
    nonceHash: string;
    address: string;
    chainId: number;
    domain: string;
    expiresAt: string;
  }): Awaitable<void>;
  findNonce(nonceHash: string): Awaitable<NonceRecord | null>;
  consumeNonce(id: string): Awaitable<boolean>;
  upsertWallet(address: string, chainId: number): Awaitable<WalletIdentity>;
  createSession(input: {
    userId: string;
    walletId: string;
    tokenHash: string;
    expiresAt: string;
  }): Awaitable<void>;
  findSession(tokenHash: string): Awaitable<SessionRecord | null>;
  revokeSession(tokenHash: string): Awaitable<void>;
  recordSnapshot(input: {
    walletId: string;
    chainId: number;
    totalValueUsd: number;
    minimumIntervalMs: number;
  }): Awaitable<void>;
  getSnapshots(walletId: string, chainId: number): Awaitable<PerformancePoint[]>;
  cleanup(): Awaitable<void>;
  close(): Awaitable<void>;
}

export class AstravaDatabase implements AstravaDataStore {
  readonly connection: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      const absolutePath = resolve(path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      this.connection = new Database(absolutePath);
    } else {
      this.connection = new Database(path);
    }

    this.connection.exec("PRAGMA foreign_keys = ON;");
    this.connection.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        access_tier TEXT NOT NULL DEFAULT 'authenticated'
          CHECK (access_tier IN ('public', 'authenticated', 'premium')),
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        last_connected_at TEXT NOT NULL,
        UNIQUE(address, chain_id)
      );

      CREATE INDEX IF NOT EXISTS wallets_address_idx ON wallets(address);

      CREATE TABLE IF NOT EXISTS auth_nonces (
        id TEXT PRIMARY KEY,
        nonce_hash TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        domain TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      CREATE INDEX IF NOT EXISTS auth_nonces_expiry_idx ON auth_nonces(expires_at);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        chain_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        total_value_usd REAL NOT NULL CHECK(total_value_usd >= 0)
      );

      CREATE INDEX IF NOT EXISTS portfolio_snapshots_lookup_idx
        ON portfolio_snapshots(wallet_id, chain_id, timestamp);
    `);
  }

  createNonce(input: {
    nonceHash: string;
    address: string;
    chainId: number;
    domain: string;
    expiresAt: string;
  }): void {
    const now = new Date().toISOString();
    this.connection.prepare(`
      INSERT INTO auth_nonces
        (id, nonce_hash, address, chain_id, domain, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.nonceHash, input.address.toLowerCase(), input.chainId, input.domain, now, input.expiresAt);
  }

  findNonce(nonceHash: string): NonceRecord | null {
    return (this.connection.prepare(`
      SELECT id, nonce_hash, address, chain_id, domain, expires_at, used_at
      FROM auth_nonces
      WHERE nonce_hash = ?
    `).get(nonceHash) as unknown as NonceRecord | undefined) ?? null;
  }

  consumeNonce(id: string): boolean {
    const result = this.connection.prepare(`
      UPDATE auth_nonces
      SET used_at = ?
      WHERE id = ? AND used_at IS NULL AND expires_at > ?
    `).run(new Date().toISOString(), id, new Date().toISOString());
    return Number(result.changes) === 1;
  }

  upsertWallet(address: string, chainId: number): WalletIdentity {
    const normalizedAddress = address.toLowerCase();
    const now = new Date().toISOString();
    this.connection.exec("BEGIN IMMEDIATE;");

    try {
      const exactWallet = this.connection.prepare(`
        SELECT w.id AS wallet_id, w.user_id, u.access_tier
        FROM wallets w
        JOIN users u ON u.id = w.user_id
        WHERE w.address = ? AND w.chain_id = ?
      `).get(normalizedAddress, chainId) as unknown as
        | { wallet_id: string; user_id: string; access_tier: AccessTier }
        | undefined;

      if (exactWallet) {
        this.connection.prepare("UPDATE wallets SET last_connected_at = ? WHERE id = ?").run(now, exactWallet.wallet_id);
        this.connection.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, exactWallet.user_id);
        this.connection.exec("COMMIT;");
        return {
          userId: exactWallet.user_id,
          walletId: exactWallet.wallet_id,
          accessTier: exactWallet.access_tier
        };
      }

      const existingUser = this.connection.prepare(`
        SELECT w.user_id, u.access_tier
        FROM wallets w
        JOIN users u ON u.id = w.user_id
        WHERE w.address = ?
        LIMIT 1
      `).get(normalizedAddress) as unknown as { user_id: string; access_tier: AccessTier } | undefined;

      const userId = existingUser?.user_id ?? randomUUID();
      const accessTier = existingUser?.access_tier ?? "authenticated";

      if (!existingUser) {
        this.connection.prepare(`
          INSERT INTO users (id, access_tier, created_at, last_login_at)
          VALUES (?, ?, ?, ?)
        `).run(userId, accessTier, now, now);
      } else {
        this.connection.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, userId);
      }

      const walletId = randomUUID();
      this.connection.prepare(`
        INSERT INTO wallets (id, user_id, address, chain_id, created_at, last_connected_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(walletId, userId, normalizedAddress, chainId, now, now);

      this.connection.exec("COMMIT;");
      return { userId, walletId, accessTier };
    } catch (error) {
      this.connection.exec("ROLLBACK;");
      throw error;
    }
  }

  createSession(input: {
    userId: string;
    walletId: string;
    tokenHash: string;
    expiresAt: string;
  }): void {
    this.connection.prepare(`
      INSERT INTO sessions (id, user_id, wallet_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.userId, input.walletId, input.tokenHash, new Date().toISOString(), input.expiresAt);
  }

  findSession(tokenHash: string): SessionRecord | null {
    const row = this.connection.prepare(`
      SELECT
        s.id,
        s.user_id,
        s.wallet_id,
        w.address,
        w.chain_id,
        u.access_tier,
        s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN wallets w ON w.id = s.wallet_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
    `).get(tokenHash, new Date().toISOString()) as unknown as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      address: row.address,
      chainId: row.chain_id,
      accessTier: row.access_tier,
      expiresAt: row.expires_at
    };
  }

  revokeSession(tokenHash: string): void {
    this.connection.prepare(`
      UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), tokenHash);
  }

  recordSnapshot(input: {
    walletId: string;
    chainId: number;
    totalValueUsd: number;
    minimumIntervalMs: number;
  }): void {
    const latest = this.connection.prepare(`
      SELECT timestamp FROM portfolio_snapshots
      WHERE wallet_id = ? AND chain_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(input.walletId, input.chainId) as unknown as { timestamp: string } | undefined;

    if (latest && Date.now() - new Date(latest.timestamp).getTime() < input.minimumIntervalMs) {
      return;
    }

    this.connection.prepare(`
      INSERT INTO portfolio_snapshots (id, wallet_id, chain_id, timestamp, total_value_usd)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), input.walletId, input.chainId, new Date().toISOString(), input.totalValueUsd);
  }

  getSnapshots(walletId: string, chainId: number): PerformancePoint[] {
    const rows = this.connection.prepare(`
      SELECT timestamp, total_value_usd
      FROM portfolio_snapshots
      WHERE wallet_id = ? AND chain_id = ?
      ORDER BY timestamp ASC
    `).all(walletId, chainId) as unknown as Array<{ timestamp: string; total_value_usd: number }>;

    return rows.map((row) => ({ timestamp: row.timestamp, valueUsd: row.total_value_usd }));
  }

  cleanup(): void {
    const now = new Date().toISOString();
    this.connection.prepare("DELETE FROM auth_nonces WHERE expires_at <= ? OR used_at IS NOT NULL").run(now);
    this.connection.prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(now);
  }

  close(): void {
    this.connection.close();
  }
}
