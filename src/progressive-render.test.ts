import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const css = readFileSync(new URL("styles.css", root), "utf8");
const pages = [
  "index.html",
  "models.html",
  "backtesting.html",
  "terminal.html",
  "portfolio.html",
  "signals.html",
  "research.html",
  "research-crypto-participation.html",
  "research-weekly-structure.html",
  "research-mortgage-pressure.html",
  "methodology.html",
  "privacy.html",
  "terms.html"
];

describe("progressive page rendering", () => {
  it("keeps reveal content visible until JavaScript starts", () => {
    expect(css).toMatch(/\.reveal\s*{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s);
    expect(css).toMatch(/\.js \.reveal\s*{[^}]*opacity:\s*0;/s);
    expect(css).toMatch(/\.js \.reveal\.is-visible\s*{[^}]*opacity:\s*1;/s);
  });

  it.each(pages)("renders %s without a loading-wallet placeholder", (page) => {
    const html = readFileSync(new URL(page, root), "utf8");
    expect(html).not.toContain("Loading wallet");
    expect(html).toContain("Connect Wallet");
  });

  it("keeps the local Earth fallback filled throughout its rotation", () => {
    const html = readFileSync(new URL("index.html", root), "utf8");

    expect(html).toContain("hero-world-css-globe");
    expect(html).not.toContain("earth-orbital.webp");
    expect(css).toMatch(
      /\.hero-world-css-texture\s*{[^}]*inset:\s*0;[^}]*background-repeat:\s*repeat-x;[^}]*background-size:\s*auto 100%;/s,
    );
    expect(css).not.toMatch(/\.hero-world-css-texture\s*{[^}]*width:\s*400%;/s);
  });
});
