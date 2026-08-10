import { createHmac, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AppConfig } from "./config.js";

export const SESSION_COOKIE = "aq_session";
export const REQUEST_HEADER = "x-astrava-request";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "The request could not be validated.");
  }
  return parsed.data;
}

export function requireTrustedOrigin(config: AppConfig) {
  const trustedOrigin = config.appUrl.origin;

  return (request: Request, _response: Response, next: NextFunction): void => {
    const origin = request.get("origin");
    const marker = request.get(REQUEST_HEADER);

    if (origin !== trustedOrigin || marker !== "wallet-auth") {
      next(new ApiError(403, "UNTRUSTED_ORIGIN", "This request did not come from AstravaQuant."));
      return;
    }

    next();
  };
}

export function sessionCookieOptions(config: AppConfig, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt
  };
}

export function clearSessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
    path: "/"
  };
}
