import type { RedisClient } from "../state/redis";
import type { NormalizedEvent, PlatformPrice, PlatformName } from "../types";
import { PLATFORMS } from "../types";

const PREFIX = "scraped-price:v1";
const DEFAULT_TTL = 7200; // 2 hours
const CHUNK_SIZE = 100;

interface ScrapedPrice {
  min: number;
  max: number;
  currency: string;
  url?: string;
  scrapedAt: string;
}

const SEARCH_URLS: Record<
  PlatformName,
  (name: string, eventUrl: string) => string
> = {
  stubhub: (name) =>
    `https://www.stubhub.com/search?q=${encodeURIComponent(name)}`,
  vividseats: (name) =>
    `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(name)}`,
  ticketmaster: (_name, eventUrl) => eventUrl,
  seatgeek: (name) =>
    `https://seatgeek.com/search?search=${encodeURIComponent(name)}`,
};

export interface PriceStore {
  /** Write a scraped price for one platform+event */
  set(
    eventId: string,
    opts: {
      min: number;
      max: number;
      platform: PlatformName;
      url?: string;
      currency?: string;
      ttlSec?: number;
    }
  ): Promise<void>;

  /** Batch-enrich N events with all platform prices in minimal Redis calls. */
  enrich(events: NormalizedEvent[]): Promise<NormalizedEvent[]>;
}

function key(eventId: string, platform: PlatformName): string {
  return `${PREFIX}:${platform}:${eventId}`;
}

type PriceSource = "discovery-api" | "seatgeek" | "scraped";

function inferSource(event: NormalizedEvent): PriceSource {
  return event.platform === "seatgeek" ? "seatgeek" : "discovery-api";
}

export function createPriceStore(redis: RedisClient): PriceStore {
  return {
    async set(eventId, opts) {
      const {
        min,
        max,
        platform,
        currency = "USD",
        ttlSec = DEFAULT_TTL,
        url,
      } = opts;

      const data: ScrapedPrice = {
        min,
        max,
        currency,
        ...(url !== undefined && { url }),
        scrapedAt: new Date().toISOString(),
      };
      await redis.set(key(eventId, platform), data, { ex: ttlSec });
    },

    async enrich(events) {
      if (events.length === 0) return events;

      // Build all keys: N events x P platforms
      const keys: string[] = [];
      for (const event of events) {
        for (const platform of PLATFORMS) {
          keys.push(key(event.platformEventId, platform));
        }
      }

      // Batch mget in chunks to stay within Upstash request limits
      const values: (ScrapedPrice | null)[] = [];
      for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
        const chunk = keys.slice(i, i + CHUNK_SIZE);
        const results = await redis.mget<ScrapedPrice>(...chunk);
        values.push(...results);
      }

      // Map results back: every PLATFORMS.length entries = 1 event
      const platformCount = PLATFORMS.length;

      return events.map((event, eventIdx) => {
        try {
          const platformPrices: PlatformPrice[] = [];

          // Include event's own priceRange first
          if (event.priceRange) {
            platformPrices.push({
              platform: event.platform,
              min: event.priceRange.min,
              max: event.priceRange.max,
              currency: event.priceRange.currency,
              url: event.url,
              source: event.priceRange.source ?? inferSource(event),
            });
          }

          // Add scraped prices from other platforms
          for (let pIdx = 0; pIdx < platformCount; pIdx++) {
            const platform = PLATFORMS[pIdx];
            const price = values[eventIdx * platformCount + pIdx];
            if (!price) continue;
            if (platform === event.platform && event.priceRange) continue;

            const url =
              price.url ?? SEARCH_URLS[platform](event.name, event.url);
            platformPrices.push({
              platform,
              min: price.min,
              max: price.max,
              currency: price.currency,
              url,
              source: "scraped",
            });
          }

          // Sort by min ascending (cheapest first)
          platformPrices.sort((a, b) => a.min - b.min);

          // If no priceRange but has scraped prices, use best one
          let priceRange = event.priceRange;
          if (!priceRange && platformPrices.length > 0) {
            const best = platformPrices[0];
            priceRange = {
              min: best.min,
              max: best.max,
              currency: best.currency,
              source: "scraped",
            };
          }

          return {
            ...event,
            priceRange,
            platformPrices,
          };
        } catch (err) {
          console.warn(`Price enrichment failed for ${event.platformEventId}: ${err}`);
          return event;
        }
      });
    },
  };
}

/** Returns events that DON'T have fresh cache entries for the given platform. */
export async function filterStale(
  redis: RedisClient,
  events: NormalizedEvent[],
  platform: PlatformName
): Promise<NormalizedEvent[]> {
  if (events.length === 0) return [];

  const keys = events.map((e) => key(e.platformEventId, platform));
  const fresh = new Set<number>();

  for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const results = await redis.mget<ScrapedPrice>(...chunk);
    for (let j = 0; j < results.length; j++) {
      if (results[j]) fresh.add(i + j);
    }
  }

  return events.filter((_, idx) => !fresh.has(idx));
}
