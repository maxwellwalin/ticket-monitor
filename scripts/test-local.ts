/**
 * Local test script — runs the monitor once and prints results.
 * Usage: bun run scripts/test-local.ts
 *
 * Requires TICKETMASTER_API_KEY in .env
 * Skips email sending and Redis — just tests the TM API integration.
 */

import { loadWatchlist } from "../src/config/loader";
import { TicketmasterAdapter } from "../src/platforms/index";
import type { IAttractionCache } from "../src/platforms/ticketmaster/cache";
import type { NormalizedEvent } from "../src/types";

/** In-memory stub so we can run without Redis */
class MemoryAttractionCache implements IAttractionCache {
  private map = new Map<string, string>();
  async get(name: string) {
    return this.map.get(name) ?? null;
  }
  async set(name: string, id: string) {
    this.map.set(name, id);
  }
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

  const platforms = [new TicketmasterAdapter(new MemoryAttractionCache())];

  for (const platform of platforms) {
    console.log(`\nPlatform: ${platform.name}`);

    for (const artist of config.artists) {
      console.log(`\nSearching for artist: ${artist.name}`);
      const events = await platform.searchEventsByArtist(
        artist.name,
        config.settings.geo_filter
      );
      const maxPrice = artist.max_price ?? config.settings.default_max_price;
      console.log(`  Found ${events.length} events`);

      for (const event of events) {
        const belowThreshold =
          event.priceRange && event.priceRange.min <= maxPrice;
        const marker = belowThreshold ? " *** MATCH ***" : "";
        console.log(
          `  - ${event.name} | ${event.date} | ${event.venueName}, ${event.venueCity}`
        );
        console.log(
          `    Status: ${event.status} | Price: ${event.priceRange ? `$${event.priceRange.min}-$${event.priceRange.max}` : "N/A"} | Max: $${maxPrice}${marker}`
        );
        console.log(`    URL: ${event.url}`);
      }
    }

    for (const eventWatch of config.events) {
      console.log(`\nSearching for event: ${eventWatch.name}`);
      let events: NormalizedEvent[] = [];
      if (eventWatch.ticketmaster_event_id) {
        const event = await platform.getEventById(
          eventWatch.ticketmaster_event_id
        );
        events = event ? [event] : [];
      } else if (eventWatch.ticketmaster_keyword) {
        events = await platform.searchEventsByKeyword(
          eventWatch.ticketmaster_keyword
        );
      } else {
        events = [];
      }

      const maxPrice =
        eventWatch.max_price ?? config.settings.default_max_price;
      console.log(`  Found ${events.length} events`);

      for (const event of events) {
        const belowThreshold =
          event.priceRange && event.priceRange.min <= maxPrice;
        const marker = belowThreshold ? " *** MATCH ***" : "";
        console.log(
          `  - ${event.name} | ${event.date} | ${event.venueName}, ${event.venueCity}`
        );
        console.log(
          `    Status: ${event.status} | Price: ${event.priceRange ? `$${event.priceRange.min}-$${event.priceRange.max}` : "N/A"} | Max: $${maxPrice}${marker}`
        );
        console.log(`    URL: ${event.url}`);
      }
    }
  }

  console.log("\n--- Done ---");
}

main().catch(console.error);
