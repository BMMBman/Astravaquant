import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex
} from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import type { AuthSession } from "../shared/contracts.js";
import { getSupportedChain, type AppConfig } from "./config.js";
import type { AstravaDatabase } from "./database.js";
import {
  ApiError,
  clearSessionCookieOptions,
  createOpaqueToken,
  hashToken,
  parseBody,
  requireTrustedOrigin,
  sessionCookieOptions,
  SESSION_COOKIE
} from "./security.js";

const nonceRequestSchema = z.object({
  address: z.string().min(42).max(42),
  chainId: z.number().int().positive()
});

const verificationSchema = z.object({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(2048)
});

function emptySession(): AuthSession {
  return {
    authenticated: false,
    address: null,
    chainId: null,
    network: null,
    accessTier: "public",
    expiresAt: null
  };
}

export function sessionResponse(request: Request): AuthSession {
  const session = request.astravaSession;
  if (!session) {
    return emptySession();
  }

  return {
    authenticated: true,
    address: getAddress(session.address),
    chainId: session.chainId,
    network: getSupportedChain(session.chainId)?.name ?? "Unsupported network",
    accessTier: session.accessTier,
    expiresAt: session.expiresAt
  };
}

interface SiweVerifier {
  verifySiweMessage(parameters: {
    address: Address;
    message: string;
    signature: Hex;
    domain: string;
    nonce: string;
    scheme: string;
    time: Date;
  }): Promise<boolean>;
}

function createClients(config: AppConfig): Map<number, SiweVerifier> {
  const chains = [mainnet, base, arbitrum] as const;
  return new Map(
    chains.map((chain) => {
      const client = createPublicClient({
        chain,
        transport: http(config.rpcUrls[chain.id])
      });
      return [chain.id, { verifySiweMessage: (parameters) => client.verifySiweMessage(parameters) }];
    })
  );
}

export function attachSession(config: AppConfig, database: AstravaDatabase) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      request.astravaSession = database.findSession(hashToken(token, config.sessionSecret)) ?? undefined;
    }
    next();
  };
}

export function requireAuth(request: Request, _response: Response, next: NextFunction): void {
  if (!request.astravaSession) {
    next(new ApiError(401, "AUTH_REQUIRED", "Connect and authenticate your wallet to open this dashboard."));
    return;
  }
  next();
}

export function requireAccess(minimum: "authenticated" | "premium") {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const session = request.astravaSession;
    if (!session) {
      next(new ApiError(401, "AUTH_REQUIRED", "Wallet authentication is required."));
      return;
    }
    if (minimum === "premium" && session.accessTier !== "premium") {
      next(new ApiError(403, "PREMIUM_REQUIRED", "This research is reserved for premium access."));
      return;
    }
    next();
  };
}

export function createAuthRouter(config: AppConfig, database: AstravaDatabase): Router {
  const router = Router();
  const clients = createClients(config);
  const mutationGuard = requireTrustedOrigin(config);
  const nonceRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many authentication attempts. Please wait a moment." } }
  });

  router.get("/session", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(sessionResponse(request));
  });

  router.post("/nonce", mutationGuard, nonceRateLimit, (request, response, next) => {
    try {
      const input = parseBody(nonceRequestSchema, request.body);
      let address: Address;
      try {
        address = getAddress(input.address);
      } catch {
        throw new ApiError(400, "INVALID_ADDRESS", "Enter a valid EVM wallet address.");
      }

      const chain = getSupportedChain(input.chainId);
      if (!chain) {
        throw new ApiError(400, "UNSUPPORTED_NETWORK", "Switch to Ethereum, Base, or Arbitrum to continue.");
      }

      const nonce = randomBytes(16).toString("hex");
      const issuedAt = new Date();
      const expirationTime = new Date(issuedAt.getTime() + 5 * 60 * 1000);
      const domain = config.appUrl.host;
      const message = createSiweMessage({
        address,
        chainId: chain.id,
        domain,
        uri: config.appUrl.href,
        version: "1",
        nonce,
        issuedAt,
        expirationTime,
        scheme: config.appUrl.protocol.replace(":", ""),
        statement: "Sign in to AstravaQuant for read-only research and portfolio intelligence. This does not authorize a transaction."
      });

      database.createNonce({
        nonceHash: hashToken(nonce, config.sessionSecret),
        address,
        chainId: chain.id,
        domain,
        expiresAt: expirationTime.toISOString()
      });

      response.setHeader("Cache-Control", "no-store");
      response.status(201).json({ message, expiresAt: expirationTime.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/verify", mutationGuard, nonceRateLimit, async (request, response, next) => {
    try {
      const input = parseBody(verificationSchema, request.body);
      const parsed = parseSiweMessage(input.message);
      if (!parsed.address || !parsed.nonce || !parsed.chainId || !parsed.domain || !parsed.uri) {
        throw new ApiError(400, "INVALID_AUTH_MESSAGE", "The wallet authentication message is incomplete.");
      }

      const chain = getSupportedChain(parsed.chainId);
      const client = clients.get(parsed.chainId);
      if (!chain || !client) {
        throw new ApiError(400, "UNSUPPORTED_NETWORK", "This wallet network is not supported.");
      }

      const nonceHash = hashToken(parsed.nonce, config.sessionSecret);
      const nonceRecord = database.findNonce(nonceHash);
      const expectedAddress = getAddress(parsed.address);
      if (
        !nonceRecord ||
        nonceRecord.used_at ||
        nonceRecord.expires_at <= new Date().toISOString() ||
        nonceRecord.address !== expectedAddress.toLowerCase() ||
        nonceRecord.chain_id !== parsed.chainId ||
        nonceRecord.domain !== config.appUrl.host ||
        parsed.domain !== config.appUrl.host ||
        parsed.uri !== config.appUrl.href
      ) {
        throw new ApiError(401, "AUTH_MESSAGE_EXPIRED", "This sign-in request is expired or has already been used.");
      }

      const verified = await client.verifySiweMessage({
        address: expectedAddress,
        message: input.message,
        signature: input.signature as Hex,
        domain: config.appUrl.host,
        nonce: parsed.nonce,
        scheme: config.appUrl.protocol.replace(":", ""),
        time: new Date()
      });

      if (!verified) {
        throw new ApiError(401, "INVALID_SIGNATURE", "The wallet signature could not be verified.");
      }

      if (!database.consumeNonce(nonceRecord.id)) {
        throw new ApiError(401, "AUTH_MESSAGE_EXPIRED", "This sign-in request is expired or has already been used.");
      }

      const identity = database.upsertWallet(expectedAddress, chain.id);
      const sessionToken = createOpaqueToken();
      const expiresAt = new Date(Date.now() + config.sessionTtlMs);
      database.createSession({
        userId: identity.userId,
        walletId: identity.walletId,
        tokenHash: hashToken(sessionToken, config.sessionSecret),
        expiresAt: expiresAt.toISOString()
      });

      response.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(config, expiresAt));
      request.astravaSession = {
        id: "new",
        userId: identity.userId,
        walletId: identity.walletId,
        address: expectedAddress,
        chainId: chain.id,
        accessTier: identity.accessTier,
        expiresAt: expiresAt.toISOString()
      };
      response.setHeader("Cache-Control", "no-store");
      response.json(sessionResponse(request));
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", mutationGuard, (request, response) => {
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      database.revokeSession(hashToken(token, config.sessionSecret));
    }
    response.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(config));
    response.setHeader("Cache-Control", "no-store");
    response.json(emptySession());
  });

  return router;
}
