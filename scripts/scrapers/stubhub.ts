/**
 * StubHub scraper — searches for events, navigates to event detail pages,
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

export async function scrapeStubHub(
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
      console.log(`  [StubHub ${i + 1}/${events.length}] ${event.artistName}`);

      try {
        // Step 1: Search for the artist
        const searchUrl = `https://www.stubhub.com/search?q=${encodeURIComponent(event.artistName)}`;
        await navigateTo(page, searchUrl);

        if (await isBlockedPage(page)) {
          console.log(`    Blocked — skipping`);
          failed++;
          continue;
        }

        // Step 2: Find event links from search results
        const eventDate = event.date.slice(0, 10); // YYYY-MM-DD
        const eventLinks = await page.evaluate(() => {
          const links: string[] = [];
          for (const a of document.querySelectorAll("a[href*='/event/']")) {
            links.push((a as HTMLAnchorElement).href);
          }
          return [...new Set(links)];
        });

        // Match by date in the URL (StubHub URLs contain M-D-YYYY)
        const [year, month, day] = eventDate.split("-");
        const urlDatePattern = `${parseInt(month)}-${parseInt(day)}-${year}`;
        let targetUrl = eventLinks.find((l) => l.includes(urlDatePattern));

        // Fallback: match by city slug in URL
        if (!targetUrl) {
          const citySlug = event.venueCity.toLowerCase().replace(/\s+/g, "-");
          targetUrl = eventLinks.find((l) => l.includes(citySlug));
        }

        if (!targetUrl) {
          console.log(`    No matching event link (date/city) — skipping`);
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

        // Step 4: Extract prices (JSON-LD primary, body text fallback)
        const jsonLdPrices = await extractJsonLdPrices(page);
        if (jsonLdPrices && jsonLdPrices.currency === "USD") {
          await cache.set(event.platformEventId, {
            min: jsonLdPrices.min,
            max: jsonLdPrices.max,
            platform: "stubhub",
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
            platform: "stubhub",
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
