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

  it("allows the link-shared workbook without service-account credentials", () => {
    const config = loadConfig(productionEnvironment);
    expect(config.googleSheets).toBeNull();
    expect(config.googleSheetsId).toBe("1biKNqqaBGKRYYFgJ8ND-DozvwD7R9h9_r4B5YXeRYzA");
    expect(config.valuationSheetsId).toBe("1CDRiyNvMiQEz-YsrJT6vOEPN-CwAMj6cQrMYmY01bxE");
  });

  it("requires service-account credentials as a complete pair", () => {
    expect(() => loadConfig({ ...productionEnvironment, GOOGLE_SERVICE_ACCOUNT_EMAIL: "reader@example.com" })).toThrow(
      "service-account access requires"
    );
  });
});
