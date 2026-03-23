/**
 * Combined scraper + monitor — single hourly pipeline.
 *
 * 1. Discover events from TM + SeatGeek APIs
 * 2. Scrape prices from TM, StubHub, Vivid Seats (all events, no cache skipping)
 * 3. Run full monitor pipeline (dedup + alert engine + email)
 *
 * Usage: bun run scripts/run.ts
 */

import { TicketmasterClient } from "../src/platforms/index";
import { SeatGeekClient } from "../src/platforms/seatgeek/index";
import { createPriceStore } from "../src/prices";
import { createRedis } from "../src/state/redis";
import { createMonitor } from "../src/monitor";
import { ApiBudgetStore } from "../src/state/api-budget";
import { RedisAlertState } from "../src/alerts/adapters/redis-state";
import { createResendSender } from "../src/alerts/resend-sender";
import { discoverForScraper } from "../src/discovery";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import type { PlatformAdapter } from "../src/platforms/types";
import { scrapeTicketmaster } from "./scrapers/ticketmaster";
import { scrapeStubHub } from "./scrapers/stubhub";
import { scrapeVividSeats } from "./scrapers/vividseats";
import { MemoryAttractionCache } from "./utils";

const MAX_EVENTS = 20;

async function main() {
  const start = Date.now();
  console.log(`=== Ticket Monitor Run (${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}) ===\n`);

  const redis = createRedis();
  const priceCache = createPriceStore(redis);

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

  // --- Phase 1: Discover events ---
  console.log("[1/3] Discovering events...");
  const discovery = await discoverForScraper({ platforms });
  for (const err of discovery.errors) console.error(`  Error: ${err}`);
  console.log(`  ${discovery.apiCallsUsed} API calls, ${discovery.events.length} unique events`);

  if (discovery.events.length === 0) {
    console.log("No events found — done.");
    return;
  }

  const events = discovery.events.slice(0, MAX_EVENTS);
  if (discovery.events.length > MAX_EVENTS) {
    console.log(`  Capped at ${MAX_EVENTS} (${discovery.events.length - MAX_EVENTS} skipped)`);
  }

  // --- Phase 2: Scrape all events (no cache skipping) ---
  console.log("\n[2/3] Scraping prices...");

  const needsTm = events.filter(
    (e) => e.platform === "ticketmaster" && !e.priceRange && e.url
  );

  const results = {
    tm: { scraped: 0, failed: 0, soldOut: 0 },
    stubhub: { scraped: 0, failed: 0 },
    vivid: { scraped: 0, failed: 0 },
  };

  const tasks: Promise<void>[] = [];
  if (needsTm.length > 0) {
    tasks.push(scrapeTicketmaster(needsTm, priceCache).then((r) => { results.tm = r; }));
  }
  tasks.push(scrapeStubHub(events, priceCache).then((r) => { results.stubhub = r; }));
  tasks.push(scrapeVividSeats(events, priceCache).then((r) => { results.vivid = r; }));

  await Promise.allSettled(tasks);

  console.log(`  TM: ${results.tm.scraped} scraped, ${results.tm.soldOut} sold out, ${results.tm.failed} failed`);
  console.log(`  StubHub: ${results.stubhub.scraped} scraped, ${results.stubhub.failed} failed`);
  console.log(`  Vivid: ${results.vivid.scraped} scraped, ${results.vivid.failed} failed`);

  // --- Phase 3: Run monitor pipeline (dedup + alerts + email) ---
  console.log("\n[3/3] Running alert engine...");

  const alertState = new RedisAlertState(redis);
  const apiBudget = new ApiBudgetStore(redis);
  const sender = createResendSender();

  const mon = createMonitor({ alertState, apiBudget, platforms, sender, priceStore: priceCache });
  const monResult = await mon.run();

  console.log(`  Events checked: ${monResult.eventsChecked}`);
  console.log(`  Alerts sent: ${monResult.alertsSent}`);
  console.log(`  API calls: ${monResult.apiCallsUsed}`);
  for (const err of monResult.errors) console.error(`  Error: ${err}`);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Done (${elapsed}s) ===`);
}

main().catch(console.error);
