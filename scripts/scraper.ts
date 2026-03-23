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
import { createPriceStore, filterStale } from "../src/prices";
import { createRedis } from "../src/state/redis";
import { discoverForScraper } from "../src/discovery";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import type { PlatformAdapter } from "../src/platforms/types";
import { scrapeTicketmaster } from "./scrapers/ticketmaster";
import { scrapeStubHub } from "./scrapers/stubhub";
import { scrapeVividSeats } from "./scrapers/vividseats";
import { MemoryAttractionCache } from "./utils";

async function main() {
  const start = Date.now();
  console.log("=== Multi-Platform Price Scraper ===\n");

  const redis = createRedis();
  const priceCache = createPriceStore(redis);
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

  const discovery = await discoverForScraper({ platforms });

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
  const [staleTm, staleSh, staleVs] = await Promise.all([
    filterStale(redis, eventsToScrape, "ticketmaster"),
    filterStale(redis, eventsToScrape, "stubhub"),
    filterStale(redis, eventsToScrape, "vividseats"),
  ]);

  const results = {
    tm: { scraped: 0, failed: 0, soldOut: 0 },
    stubhub: { scraped: 0, failed: 0 },
    vivid: { scraped: 0, failed: 0 },
  };

  // 3. Build scrape tasks (each gets its own browser, runs in parallel)
  const needsTm = staleTm.filter(
    (e) => e.platform === "ticketmaster" && !e.priceRange && e.url
  );
  const needsSh = staleSh;
  const needsVs = staleVs;

  const totalTmEligible = eventsToScrape.filter(
    (e) => e.platform === "ticketmaster" && !e.priceRange && e.url
  ).length;

  console.log(
    `\n--- Launching parallel scrapers ---`
  );
  console.log(
    `  TM: ${needsTm.length} events (${totalTmEligible - needsTm.length} cached)`
  );
  console.log(
    `  StubHub: ${needsSh.length} events (${eventsToScrape.length - needsSh.length} cached)`
  );
  console.log(
    `  Vivid Seats: ${needsVs.length} events (${eventsToScrape.length - needsVs.length} cached)`
  );

  const tasks: Promise<void>[] = [];

  if (needsTm.length > 0) {
    tasks.push(
      scrapeTicketmaster(needsTm, priceCache).then((r) => { results.tm = r; })
    );
  }
  if (needsSh.length > 0) {
    tasks.push(
      scrapeStubHub(needsSh, priceCache).then((r) => { results.stubhub = r; })
    );
  }
  if (needsVs.length > 0) {
    tasks.push(
      scrapeVividSeats(needsVs, priceCache).then((r) => { results.vivid = r; })
    );
  }

  await Promise.allSettled(tasks);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Summary (${elapsed}s) ===`);
  console.log(
    `  TM: ${results.tm.scraped} scraped, ${results.tm.soldOut} sold out, ${results.tm.failed} failed`
  );
  console.log(
    `  StubHub: ${results.stubhub.scraped} scraped, ${results.stubhub.failed} failed`
  );
  console.log(
    `  Vivid: ${results.vivid.scraped} scraped, ${results.vivid.failed} failed`
  );
}

main().catch(console.error);
