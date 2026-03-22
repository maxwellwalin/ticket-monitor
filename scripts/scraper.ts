/**
 * Multi-platform price scraper — runs locally on Mac via launchd.
 *
 * - TM: scrapes event pages missing API prices
 * - StubHub: search → event detail → JSON-LD prices
 * - Vivid Seats: search → event detail → JSON-LD prices
 *
 * Usage: bun run scripts/scraper.ts
 */

import { TicketmasterClient } from "../src/platforms/index";
import { SeatGeekClient } from "../src/platforms/seatgeek/index";
import { createPriceStore } from "../src/prices";
import { createRedis } from "../src/state/redis";
import { ApiBudgetStore } from "../src/state/api-budget";
import { discoverEvents } from "../src/discovery";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import type { PlatformAdapter } from "../src/platforms/types";
import { closeBrowser } from "./scrapers/shared";
import { scrapeTicketmaster } from "./scrapers/ticketmaster";
import { scrapeStubHub } from "./scrapers/stubhub";
import { scrapeVividSeats } from "./scrapers/vividseats";
import { MemoryAttractionCache } from "./utils";

async function main() {
  const start = Date.now();
  console.log("=== Multi-Platform Price Scraper ===\n");

  const redis = createRedis();
  const priceCache = createPriceStore(redis);
  const apiBudget = new ApiBudgetStore(redis);

  // 1. Discover events from APIs
  console.log("Fetching events from APIs...");

  const tmRateLimiter = createRateLimiter(500);
  const sgRateLimiter = createRateLimiter(200);

  const platforms: PlatformAdapter[] = [
    new TicketmasterClient({
      cache: new MemoryAttractionCache(),
      rateLimiter: tmRateLimiter,
    }),
  ];
  if (process.env.SEATGEEK_CLIENT_ID) {
    platforms.push(
      new SeatGeekClient({
        rateLimiter: sgRateLimiter,
        performerCache: new MemoryAttractionCache(),
      })
    );
  }

  const discovery = await discoverEvents({ platforms, apiBudget });
  await apiBudget.increment(discovery.apiCallsUsed);

  if (discovery.errors.length > 0) {
    for (const err of discovery.errors) console.error(`  Error: ${err}`);
  }

  console.log(
    `  ${discovery.apiCallsUsed} API calls, ${discovery.events.length} unique events`
  );

  if (discovery.events.length === 0) {
    console.log("No events to scrape!");
    return;
  }

  const MAX_EVENTS = 20;
  const eventsToScrape = discovery.events.slice(0, MAX_EVENTS);
  if (discovery.events.length > MAX_EVENTS) {
    console.log(
      `  Capped at ${MAX_EVENTS} events (${discovery.events.length - MAX_EVENTS} skipped)`
    );
  }

  // 2. Check for fresh cached prices
  const allIds = eventsToScrape.map((e) => e.platformEventId);
  const [freshTm, freshSh, freshVs] = await Promise.all([
    priceCache.hasFreshPrices(allIds, "ticketmaster"),
    priceCache.hasFreshPrices(allIds, "stubhub"),
    priceCache.hasFreshPrices(allIds, "vividseats"),
  ]);

  const results = {
    tm: { scraped: 0, failed: 0 },
    stubhub: { scraped: 0, failed: 0 },
    vivid: { scraped: 0, failed: 0 },
  };

  try {
    // 3. TM: scrape events missing API prices (and no fresh cache)
    const needsTm = eventsToScrape.filter(
      (e) =>
        e.platform === "ticketmaster" &&
        !e.priceRange &&
        e.url &&
        !freshTm.has(e.platformEventId)
    );
    if (needsTm.length > 0) {
      console.log(
        `\n--- Ticketmaster (${needsTm.length} events, ${eventsToScrape.filter((e) => e.platform === "ticketmaster" && !e.priceRange && e.url).length - needsTm.length} cached) ---`
      );
      results.tm = await scrapeTicketmaster(needsTm, priceCache);
    }

    // 4. StubHub: all events without fresh cache
    const needsSh = eventsToScrape.filter(
      (e) => !freshSh.has(e.platformEventId)
    );
    if (needsSh.length > 0) {
      console.log(
        `\n--- StubHub (${needsSh.length} events, ${eventsToScrape.length - needsSh.length} cached) ---`
      );
      results.stubhub = await scrapeStubHub(needsSh, priceCache);
    } else {
      console.log(
        `\n--- StubHub: all ${eventsToScrape.length} cached, skipping ---`
      );
    }

    // 5. Vivid Seats: all events without fresh cache
    const needsVs = eventsToScrape.filter(
      (e) => !freshVs.has(e.platformEventId)
    );
    if (needsVs.length > 0) {
      console.log(
        `\n--- Vivid Seats (${needsVs.length} events, ${eventsToScrape.length - needsVs.length} cached) ---`
      );
      results.vivid = await scrapeVividSeats(needsVs, priceCache);
    } else {
      console.log(
        `\n--- Vivid Seats: all ${eventsToScrape.length} cached, skipping ---`
      );
    }
  } finally {
    await closeBrowser();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Summary (${elapsed}s) ===`);
  console.log(
    `  TM: ${results.tm.scraped} scraped, ${results.tm.failed} failed`
  );
  console.log(
    `  StubHub: ${results.stubhub.scraped} scraped, ${results.stubhub.failed} failed`
  );
  console.log(
    `  Vivid: ${results.vivid.scraped} scraped, ${results.vivid.failed} failed`
  );
}

main().catch(console.error);
