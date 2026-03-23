/**
 * Scrape prices for all discovered events.
 *
 * Discovers events from TM + SeatGeek APIs, then scrapes prices from
 * Ticketmaster, StubHub, and Vivid Seats. Writes prices to Redis.
 *
 * Usage: bun run scrape
 */

import { createPriceStore } from "../src/prices";
import { createRedis } from "../src/state/redis";
import { discoverForScraper } from "../src/discovery";
import { scrapeTicketmaster } from "./scrapers/ticketmaster";
import { scrapeStubHub } from "./scrapers/stubhub";
import { scrapeVividSeats } from "./scrapers/vividseats";
import { createPlatforms, MAX_EVENTS } from "./utils";

async function main() {
  const start = Date.now();
  console.log(`=== Scrape (${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}) ===\n`);

  const redis = createRedis();
  const priceCache = createPriceStore(redis);
  const platforms = createPlatforms();

  console.log("Discovering events...");
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

  console.log("\nScraping prices...");
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

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Done (${elapsed}s) ===`);
  console.log(`  TM: ${results.tm.scraped} scraped, ${results.tm.soldOut} sold out, ${results.tm.failed} failed`);
  console.log(`  StubHub: ${results.stubhub.scraped} scraped, ${results.stubhub.failed} failed`);
  console.log(`  Vivid: ${results.vivid.scraped} scraped, ${results.vivid.failed} failed`);
}

main().catch(console.error);
