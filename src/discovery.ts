/**
 * Shared event discovery module — used by both `api/cron.ts` (via monitor.ts)
 * and `scripts/scraper.ts` (local Mac).
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

export interface DiscoveryResult {
  /** All events, deduplicated across platforms */
  events: NormalizedEvent[];
  /** Per-watch results with context for alert detection */
  watchHits: WatchHit[];
  /** Total API calls made during discovery */
  apiCallsUsed: number;
  /** Non-fatal errors encountered */
  errors: string[];
}

export interface DiscoveryDeps {
  platforms: PlatformAdapter[];
  /** If provided, check/enforce daily API limit. Omit for unlimited. */
  apiBudget?: ApiBudgetStore;
  /** Override config loading (for testing). Defaults to loadWatchlist(). */
  config?: WatchlistConfig;
}

export async function discoverEvents(
  deps: DiscoveryDeps
): Promise<DiscoveryResult> {
  const { platforms, apiBudget } = deps;
  const config = deps.config ?? loadWatchlist();
  const result: DiscoveryResult = {
    events: [],
    watchHits: [],
    apiCallsUsed: 0,
    errors: [],
  };

  let usedToday = 0;
  if (apiBudget) {
    usedToday = await apiBudget.getUsedToday();
    if (usedToday >= DAILY_API_LIMIT) {
      result.errors.push(
        `Daily API limit reached (${usedToday}/${DAILY_API_LIMIT})`
      );
      return result;
    }
  }

  // Resolve geo once, pass to all adapter calls
  const geo = resolveGeo(config.settings.geo_filter);

  const allEvents: NormalizedEvent[] = [];
  let apiCalls = 0;

  const budgetExhausted = () =>
    apiBudget ? usedToday + apiCalls >= DAILY_API_LIMIT : false;

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
          allEvents.push(...events);
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
          allEvents.push(...events);
        }
      } catch (err) {
        result.errors.push(`[${platform.name}] Event "${eventWatch.name}": ${err}`);
      }
    }
  }

  result.events = deduplicateEvents(allEvents);
  result.apiCallsUsed = apiCalls;
  return result;
}

/** Deduplicate events across platforms by artist+venue+date. Keeps first occurrence; prefers API-priced. */
export function deduplicateEvents(
  events: NormalizedEvent[]
): NormalizedEvent[] {
  const seen = new Map<string, NormalizedEvent>();
  for (const event of events) {
    const dateKey = event.date.slice(0, 10); // YYYY-MM-DD
    const key = `${event.artistName.toLowerCase()}:${event.venueName.toLowerCase()}:${dateKey}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, event);
    } else if (!existing.priceRange && event.priceRange) {
      // Prefer the one with pricing
      seen.set(key, event);
    }
  }
  return Array.from(seen.values());
}
