import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const productionEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  APP_URL: "https://www.astravaquant.com/",
  SESSION_SECRET: "production-test-secret-with-at-least-thirty-two-characters",
  DATABASE_URL: "postgresql://astravaquant:password@example.neon.tech/astravaquant"
} as NodeJS.ProcessEnv;

describe("production configuration", () => {
  it("accepts a secure Vercel configuration with durable storage", () => {
    const config = loadConfig(productionEnvironment);
    expect(config.appUrl.href).toBe("https://www.astravaquant.com/");
    expect(config.databaseUrl).toBe(productionEnvironment.DATABASE_URL);
  });

  it("fails closed when Vercel has no durable database", () => {
    const withoutDatabase = { ...productionEnvironment };
    delete withoutDatabase.DATABASE_URL;
    expect(() => loadConfig(withoutDatabase)).toThrow("DATABASE_URL is required");
  });

  it("fails closed when production has no session secret", () => {
    const withoutSecret = { ...productionEnvironment };
    delete withoutSecret.SESSION_SECRET;
    expect(() => loadConfig(withoutSecret)).toThrow("SESSION_SECRET is required");
  });

  it("requires the private-sheet credentials as one complete set", () => {
    expect(() => loadConfig({ ...productionEnvironment, GOOGLE_SHEETS_ID: "1biKNqqaBGKRYYFgJ8ND-DozvwD7R9h9_r4B5YXeRYzA" })).toThrow(
      "Google Sheets requires"
    );
  });
});
