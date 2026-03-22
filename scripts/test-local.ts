/**
 * Local test script — runs the monitor once and prints results.
 * Usage: bun run scripts/test-local.ts
 *
 * Requires TICKETMASTER_API_KEY in .env
 * Optional: SEATGEEK_CLIENT_ID for SeatGeek integration
 */

import { loadWatchlist } from "../src/config/loader";
import { TicketmasterClient } from "../src/platforms/index";
import { SeatGeekClient } from "../src/platforms/seatgeek/index";
import { createPriceStore } from "../src/prices";
import { createRedis } from "../src/state/redis";
import { discoverEvents } from "../src/discovery";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import type { PlatformAdapter } from "../src/platforms/types";
import type { NormalizedEvent } from "../src/types";
import { MemoryAttractionCache } from "./utils";

function printEvent(event: NormalizedEvent, maxPrice: number) {
  const belowThreshold =
    event.priceRange && event.priceRange.min <= maxPrice;
  const marker = belowThreshold ? " *** MATCH ***" : "";
  console.log(
    `  - ${event.name} | ${event.date} | ${event.venueName}, ${event.venueCity}`
  );
  console.log(
    `    Status: ${event.status} | Price: ${event.priceRange ? `$${event.priceRange.min}-$${event.priceRange.max} (${event.priceRange.source || "api"})` : "N/A"} | Max: $${maxPrice}${marker}`
  );
  if (event.platformPrices && event.platformPrices.length > 0) {
    const pp = event.platformPrices
      .map((p) => `${p.platform}: $${p.min}`)
      .join(" · ");
    console.log(`    Cross-platform: ${pp}`);
  }
  console.log(`    URL: ${event.url}`);
}

async function main() {
  console.log("Loading watchlist...");
  const config = loadWatchlist();
  console.log(
    `Loaded: ${config.artists.length} artists, ${config.events.length} events`
  );
  console.log(`Geo filter:`, config.settings.geo_filter || "none");
  console.log(`Default max price: $${config.settings.default_max_price}`);
  console.log("---");

  const redis = createRedis();
  const priceStore = createPriceStore(redis);

  const tmRateLimiter = createRateLimiter(500);
  const sgRateLimiter = createRateLimiter(200);

  const platforms: PlatformAdapter[] = [
    new TicketmasterClient({
      cache: new MemoryAttractionCache(),
      rateLimiter: tmRateLimiter,
    }),
  ];

  if (process.env.SEATGEEK_CLIENT_ID) {
    platforms.push(new SeatGeekClient({
      rateLimiter: sgRateLimiter,
      performerCache: new MemoryAttractionCache(),
    }));
    console.log("SeatGeek: enabled");
  } else {
    console.log("SeatGeek: disabled (no SEATGEEK_CLIENT_ID)");
  }

  // Use shared discovery module
  const discovery = await discoverEvents({ platforms, config });

  if (discovery.errors.length > 0) {
    for (const err of discovery.errors) {
      console.error(`  Error: ${err}`);
    }
  }

  // Print per-watch results with enrichment
  for (const hit of discovery.watchHits) {
    console.log(`\nWatch: ${hit.watchName}`);
    const events = await priceStore.enrichAll(hit.events);
    console.log(`  Found ${events.length} events`);
    for (const event of events) {
      printEvent(event, hit.maxPrice);
    }
  }

  console.log(`\n--- Done (${discovery.apiCallsUsed} total API calls) ---`);
}

main().catch(console.error);
