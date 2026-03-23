/**
 * Vivid Seats scraper — searches for events, navigates to event detail pages,
 * extracts prices from JSON-LD AggregateOffer.
 *
 * Uses stealth plugin. Own browser instance for parallel execution.
 */

import type { NormalizedEvent } from "../../src/types";
import type { PriceStore } from "../../src/prices";
import {
  launchStealthBrowser,
  createContext,
  navigateTo,
  extractJsonLdPrices,
  extractBodyTextPrices,
  isBlockedPage,
} from "./shared";

export async function scrapeVividSeats(
  events: NormalizedEvent[],
  cache: PriceStore
): Promise<{ scraped: number; failed: number }> {
  const browser = await launchStealthBrowser();
  const ctx = await createContext(browser);
  const page = await ctx.newPage();

  let scraped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      console.log(`  [VividSeats ${i + 1}/${events.length}] ${event.artistName}`);

      try {
        // Step 1: Search for the artist
        const searchUrl = `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(event.artistName)}`;
        await navigateTo(page, searchUrl);

        if (await isBlockedPage(page)) {
          console.log(`    Blocked — skipping`);
          failed++;
          continue;
        }

        // Step 2: Find event links matching date/venue
        const eventDate = event.date.slice(0, 10);
        const eventLinks = await page.evaluate((artistName: string) => {
          const links: { href: string; text: string }[] = [];
          for (const a of document.querySelectorAll("a[href*='/production/']")) {
            const href = (a as HTMLAnchorElement).href;
            const text = (a.textContent || "").trim();
            if (text.toLowerCase().includes(artistName.toLowerCase().slice(0, 10))) {
              links.push({ href, text: text.slice(0, 120) });
            }
          }
          // Also match by href containing the artist slug
          if (links.length === 0) {
            const slug = artistName.toLowerCase().replace(/\s+/g, "-").slice(0, 20);
            for (const a of document.querySelectorAll(`a[href*="${slug}"]`)) {
              const href = (a as HTMLAnchorElement).href;
              if (href.includes("/production/")) {
                links.push({ href, text: (a.textContent || "").trim().slice(0, 120) });
              }
            }
          }
          return [...new Map(links.map((l) => [l.href, l])).values()];
        }, event.artistName);

        // Match by date in URL (VS URLs contain the date like 4-24-2026)
        const [year, month, day] = eventDate.split("-");
        const urlDatePattern = `${parseInt(month)}-${parseInt(day)}-${year}`;
        let targetUrl = eventLinks.find((l) => l.href.includes(urlDatePattern))?.href;

        // Fallback: first link
        if (!targetUrl && eventLinks.length > 0) {
          targetUrl = eventLinks[0].href;
        }

        if (!targetUrl) {
          console.log(`    No event link found`);
          failed++;
          continue;
        }

        // Step 3: Navigate to event detail page
        await navigateTo(page, targetUrl);

        if (await isBlockedPage(page)) {
          console.log(`    Blocked on detail page — skipping`);
          failed++;
          continue;
        }

        // Step 4: Extract prices
        const jsonLdPrices = await extractJsonLdPrices(page);
        if (jsonLdPrices && jsonLdPrices.currency === "USD") {
          await cache.set(event.platformEventId, {
            min: jsonLdPrices.min,
            max: jsonLdPrices.max,
            platform: "vividseats",
            url: page.url(),
          });
          console.log(`    $${jsonLdPrices.min} - $${jsonLdPrices.max}`);
          scraped++;
          continue;
        }

        // Fallback to body text
        const bodyPrices = await extractBodyTextPrices(page);
        if (bodyPrices) {
          await cache.set(event.platformEventId, {
            min: bodyPrices.min,
            max: bodyPrices.max,
            platform: "vividseats",
            url: page.url(),
          });
          console.log(`    $${bodyPrices.min} - $${bodyPrices.max} (body text)`);
          scraped++;
        } else {
          console.log(`    No price found`);
          failed++;
        }
      } catch (err) {
        console.error(`    Error: ${err}`);
        failed++;
      }
    }
  } finally {
    await browser.close();
  }

  return { scraped, failed };
}
