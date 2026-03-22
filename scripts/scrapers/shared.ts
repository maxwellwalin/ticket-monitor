/**
 * Shared scraper utilities — browser launch, JSON-LD extraction, bot detection.
 * All scrapers use direct connections (no proxy).
 */

import type { Page, BrowserContext, Browser } from "playwright";

// ── Browser fingerprints ──────────────────────────────────────

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Browser launcher ──────────────────────────────────────────

let _browser: Browser | null = null;

/** Launch a shared headless browser (reused across platforms). */
export async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
    ],
  });
  return _browser;
}

/** Close the shared browser. */
export async function closeBrowser(): Promise<void> {
  await _browser?.close();
  _browser = null;
}

/** Create a fresh browser context with anti-detection init scripts. */
export async function createContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: pickRandom(VIEWPORTS),
    userAgent: USER_AGENT,
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return context;
}

// ── JSON-LD price extraction (primary strategy) ───────────────

/**
 * Extract prices from JSON-LD AggregateOffer on the page.
 * This is the most reliable extraction method — structured data
 * embedded by the site itself.
 */
export async function extractJsonLdPrices(
  page: Page
): Promise<{ min: number; max: number; currency: string } | null> {
  const result = await page.evaluate(() => {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "");
        const offers = data.offers;
        if (!offers) continue;
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const o of offerList) {
          if (o.lowPrice != null) {
            return {
              min: Number(o.lowPrice),
              max: Number(o.highPrice ?? o.lowPrice),
              currency: o.priceCurrency ?? "USD",
            };
          }
          if (o.price != null) {
            return {
              min: Number(o.price),
              max: Number(o.price),
              currency: o.priceCurrency ?? "USD",
            };
          }
        }
      } catch {}
    }
    return null;
  });
  return result;
}

/**
 * Fallback: extract prices from body text when JSON-LD is absent.
 * Looks for $XX or $XX.XX patterns.
 */
export async function extractBodyTextPrices(
  page: Page
): Promise<{ min: number; max: number } | null> {
  const prices = await page.evaluate(() => {
    const body = document.body?.innerText ?? "";
    const matches = body.match(/\$(\d+(?:\.\d{2})?)/g);
    if (!matches) return [];
    return matches
      .map((m) => parseFloat(m.replace("$", "")))
      .filter((v) => v >= 10 && v <= 15000);
  });
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// ── Page helpers ──────────────────────────────────────────────

/** Navigate and wait for network to settle. */
export async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 12000 });
  } catch {}
}

/** Check if the page is showing a CAPTCHA or bot challenge. */
export async function isBlockedPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    return ["captcha", "cf-challenge", "g-recaptcha", "hcaptcha", "access denied", "are you a robot"].some(
      (s) => html.includes(s)
    );
  });
}
