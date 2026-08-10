import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("non-custodial client boundary", () => {
  it("contains no transaction-capable Wagmi action calls", () => {
    const clientFiles = ["src/client/index.ts", "src/client/wallet.ts", "src/client/portfolio.ts"];
    const source = clientFiles.map((file) => readFileSync(resolve(file), "utf8")).join("\n");
    const forbiddenCalls = ["sendTransaction", "writeContract", "sendCalls", "simulateContract", "deployContract"];
    for (const call of forbiddenCalls) {
      expect(source).not.toMatch(new RegExp(`\\b${call}\\s*\\(`));
    }
  });
});
