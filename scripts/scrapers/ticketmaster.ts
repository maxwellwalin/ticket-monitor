/**
 * Ticketmaster scraper — visits event pages directly (URLs from Discovery API),
 * extracts prices from JSON-LD or body text.
 *
 * Runs WITHOUT proxy — TM works fine with direct connections.
 * Only scrapes events that have no API price (priceRange undefined).
 */

import type { NormalizedEvent } from "../../src/types";
import type { PriceStore } from "../../src/prices";
import {
  createContext,
  navigateTo,
  extractJsonLdPrices,
  extractBodyTextPrices,
} from "./shared";

export async function scrapeTicketmaster(
  events: NormalizedEvent[],
  cache: PriceStore
): Promise<{ scraped: number; failed: number }> {
  // Direct connection — no proxy needed for TM
  const ctx = await createContext();
  const page = await ctx.newPage();

  let scraped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      console.log(`  [TM ${i + 1}/${events.length}] ${event.name}`);

      try {
        await navigateTo(page, event.url);

        // Extract prices — JSON-LD primary, body text fallback
        const jsonLdPrices = await extractJsonLdPrices(page);
        if (jsonLdPrices && jsonLdPrices.min > 0) {
          await cache.set(event.platformEventId, {
            min: jsonLdPrices.min,
            max: jsonLdPrices.max,
            platform: "ticketmaster",
            url: event.url,
          });
          console.log(`    $${jsonLdPrices.min} - $${jsonLdPrices.max}`);
          scraped++;
          continue;
        }

        const bodyPrices = await extractBodyTextPrices(page);
        if (bodyPrices) {
          await cache.set(event.platformEventId, {
            min: bodyPrices.min,
            max: bodyPrices.max,
            platform: "ticketmaster",
            url: event.url,
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
    await ctx.close();
  }

  return { scraped, failed };
}
