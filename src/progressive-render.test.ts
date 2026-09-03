import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const publicCss = readFileSync(new URL("public-redesign.css", root), "utf8");
const legacyCss = readFileSync(new URL("styles.css", root), "utf8");
const publicPages = [
  "index.html",
  "about.html",
  "archive.html",
  "models.html",
  "valuation.html",
  "backtesting.html",
  "trend-following.html",
  "ltpi-methodology.html",
  "mrpi-methodology.html",
  "valuation-methodology.html",
  "research.html",
  "research-crypto-participation.html",
  "research-weekly-structure.html",
  "research-mortgage-pressure.html",
  "methodology.html",
  "privacy.html",
  "terms.html"
];
const walletPages = ["terminal.html", "portfolio.html"];

describe("progressive page rendering", () => {
  it("keeps reveal content visible until JavaScript starts across public and legacy styles", () => {
    expect(publicCss).toMatch(/\.reveal\s*{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s);
    expect(publicCss).toMatch(/body\.aq-site\.js \.reveal\s*{[^}]*opacity:\s*0;/s);
    expect(publicCss).toMatch(/body\.aq-site\.js \.reveal\.is-visible\s*{[^}]*opacity:\s*1;/s);
    expect(legacyCss).toMatch(/\.reveal\s*{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s);
    expect(legacyCss).toMatch(/\.js \.reveal\s*{[^}]*opacity:\s*0;/s);
  });

  it.each(publicPages)("renders %s without wallet prompts in the public research shell", (page) => {
    const html = readFileSync(new URL(page, root), "utf8");
    expect(html).not.toContain("Loading wallet");
    expect(html).not.toContain("Connect Wallet");
    expect(html).toContain("public-redesign.css");
  });

  it.each(walletPages)("keeps %s wallet entry ready without the loading placeholder", (page) => {
    const html = readFileSync(new URL(page, root), "utf8");
    expect(html).not.toContain("Loading wallet");
    expect(html).toContain("Connect Wallet");
  });

  it("consolidates the legacy signals route into Models", () => {
    const html = readFileSync(new URL("signals.html", root), "utf8");
    expect(html).toContain('url=models.html');
    expect(html).toContain('window.location.replace("models.html")');
  });

  it("removes the legacy homepage globe from the public redesign", () => {
    const html = readFileSync(new URL("index.html", root), "utf8");

    expect(html).not.toContain("hero-world-css-globe");
    expect(html).not.toContain("data-earth-globe");
    expect(publicCss).not.toContain("hero-world-css-texture");
  });
});
