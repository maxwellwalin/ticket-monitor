/**
 * Shared event discovery module — used by `scripts/run.ts` (via monitor.ts).
 *
 * Collects events from all platform adapters for all watches,
 * deduplicates, and returns structured results.
 */

import { loadWatchlist } from "./config/loader";
import { resolveGeo } from "./config/geo";
import type { WatchlistConfig } from "./config/schema";
import type { PlatformAdapter } from "./platforms/types";
import type { NormalizedEvent } from "./types";
import type { ApiBudgetStore } from "./state/api-budget";

const DAILY_API_LIMIT = 4500;

export interface WatchHit {
  watchName: string;
  maxPrice: number;
  events: NormalizedEvent[];
}

// ---------------------------------------------------------------------------
// Internal: shared discovery logic
// ---------------------------------------------------------------------------

async function discoverRaw(deps: {
  platforms: PlatformAdapter[];
  config: WatchlistConfig;
  budgetGuard?: { usedToday: number; limit: number };
}): Promise<{
  watchHits: WatchHit[];
  allEvents: NormalizedEvent[];
  apiCallsUsed: number;
  errors: string[];
}> {
  const { platforms, config, budgetGuard } = deps;
  const result = {
    watchHits: [] as WatchHit[],
    allEvents: [] as NormalizedEvent[],
    apiCallsUsed: 0,
    errors: [] as string[],
  };

  if (budgetGuard && budgetGuard.usedToday >= budgetGuard.limit) {
    result.errors.push(
      `Daily API limit reached (${budgetGuard.usedToday}/${budgetGuard.limit})`
    );
    return result;
  }

  // Resolve geo once, pass to all adapter calls
  const geo = resolveGeo(config.settings.geo_filter);

  let apiCalls = 0;

  // Conservative: stop when we've reached or exceeded the limit
  const budgetExhausted = () =>
    budgetGuard
      ? budgetGuard.usedToday + apiCalls >= budgetGuard.limit
      : false;

  for (const platform of platforms) {
    // Process artist watches
    for (const artist of config.artists) {
      if (budgetExhausted()) break;
      try {
        const { data: events, apiCalls: used } =
          await platform.searchEventsByArtist(artist.name, geo);
        apiCalls += used;

        const maxPrice =
          artist.max_price ?? config.settings.default_max_price;
        if (events.length > 0) {
          result.watchHits.push({
            watchName: artist.name,
            maxPrice,
            events,
          });
          result.allEvents.push(...events);
        }
      } catch (err) {
        result.errors.push(`[${platform.name}] Artist "${artist.name}": ${err}`);
      }
    }

    // Process event watches
    for (const eventWatch of config.events) {
      if (budgetExhausted()) break;
      try {
        let events: NormalizedEvent[] = [];
        let used = 0;

        if (
          eventWatch.ticketmaster_event_id &&
          platform.name === "ticketmaster"
        ) {
          // TM event IDs only work on TM
          const r = await platform.getEventById(
            eventWatch.ticketmaster_event_id
          );
          if (r.data) events = [r.data];
          used = r.apiCalls;
        } else if (eventWatch.ticketmaster_keyword) {
          const r = await platform.searchEventsByKeyword(
            eventWatch.ticketmaster_keyword,
            geo
          );
          events = r.data;
          used = r.apiCalls;
        } else if (eventWatch.keyword) {
          const r = await platform.searchEventsByKeyword(
            eventWatch.keyword,
            geo
          );
          events = r.data;
          used = r.apiCalls;
        }

        apiCalls += used;

        const maxPrice =
          eventWatch.max_price ?? config.settings.default_max_price;
        if (events.length > 0) {
          result.watchHits.push({
            watchName: eventWatch.name,
            maxPrice,
            events,
          });
          result.allEvents.push(...events);
        }
      } catch (err) {
        result.errors.push(`[${platform.name}] Event "${eventWatch.name}": ${err}`);
      }
    }
  }

  result.apiCallsUsed = apiCalls;
  return result;
}

// ---------------------------------------------------------------------------
// Public: monitor-facing (watchHits, budget read+write)
// ---------------------------------------------------------------------------

export async function discoverForMonitor(deps: {
  platforms: PlatformAdapter[];
  apiBudget?: ApiBudgetStore;
  config?: WatchlistConfig;
}): Promise<{
  watchHits: WatchHit[];
  apiCallsUsed: number;
  errors: string[];
}> {
  const config = deps.config ?? loadWatchlist();

  let budgetGuard: { usedToday: number; limit: number } | undefined;
  if (deps.apiBudget) {
    const usedToday = await deps.apiBudget.getUsedToday();
    budgetGuard = { usedToday, limit: DAILY_API_LIMIT };
  }

  const raw = await discoverRaw({ platforms: deps.platforms, config, budgetGuard });

  if (deps.apiBudget && raw.apiCallsUsed > 0) {
    await deps.apiBudget.increment(raw.apiCallsUsed);
  }

  return {
    watchHits: raw.watchHits,
    apiCallsUsed: raw.apiCallsUsed,
    errors: raw.errors,
  };
}

// ---------------------------------------------------------------------------
// Public: scraper-facing (deduplicated events, no budget)
// ---------------------------------------------------------------------------

export async function discoverForScraper(deps: {
  platforms: PlatformAdapter[];
  config?: WatchlistConfig;
}): Promise<{
  events: NormalizedEvent[];
  apiCallsUsed: number;
  errors: string[];
}> {
  const config = deps.config ?? loadWatchlist();
  const raw = await discoverRaw({ platforms: deps.platforms, config });

  return {
    events: deduplicateEvents(raw.allEvents),
    apiCallsUsed: raw.apiCallsUsed,
    errors: raw.errors,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Deduplicate events across platforms by artist+city+date. Keeps first occurrence; prefers onsale + API-priced. */
export function deduplicateEvents(
  events: NormalizedEvent[]
): NormalizedEvent[] {
  const seen = new Map<string, NormalizedEvent>();
  for (const event of events) {
    const dateKey = event.date.slice(0, 10); // YYYY-MM-DD
    const key = `${event.artistName.toLowerCase()}:${event.venueCity.toLowerCase()}:${dateKey}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, event);
    } else if (existing.status !== "onsale" && event.status === "onsale") {
      // Prefer onsale, but only if we don't lose pricing
      if (event.priceRange || !existing.priceRange) {
        seen.set(key, event);
      }
    } else if (!existing.priceRange && event.priceRange) {
      // Prefer the one with pricing
      seen.set(key, event);
    }
  }
  return Array.from(seen.values());
}
