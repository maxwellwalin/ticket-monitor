import type { RedisClient } from "../state/redis";
import type { NormalizedEvent, PlatformPrice, PlatformName } from "../types";

const PREFIX = "scraped-price:v1";
const DEFAULT_TTL = 7200; // 2 hours

export const KNOWN_PLATFORMS: PlatformName[] = [
  "ticketmaster",
  "seatgeek",
  "stubhub",
  "vividseats",
];

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
  enrichAll(events: NormalizedEvent[]): Promise<NormalizedEvent[]>;

  /** Check which events already have a cached price for a given platform. Returns set of eventIds that have a fresh cache entry. */
  hasFreshPrices(eventIds: string[], platform: PlatformName): Promise<Set<string>>;
}

function key(eventId: string, platform: PlatformName): string {
  return `${PREFIX}:${platform}:${eventId}`;
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

    async hasFreshPrices(eventIds, platform) {
      if (eventIds.length === 0) return new Set<string>();
      const keys = eventIds.map((id) => key(id, platform));
      const CHUNK_SIZE = 100;
      const fresh = new Set<string>();
      for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
        const chunk = keys.slice(i, i + CHUNK_SIZE);
        const idChunk = eventIds.slice(i, i + CHUNK_SIZE);
        const results = await redis.mget<ScrapedPrice>(...chunk);
        for (let j = 0; j < results.length; j++) {
          if (results[j]) fresh.add(idChunk[j]);
        }
      }
      return fresh;
    },

    async enrichAll(events) {
      if (events.length === 0) return events;

      // Build all keys: N events x P platforms
      const keys: string[] = [];
      for (const event of events) {
        for (const platform of KNOWN_PLATFORMS) {
          keys.push(key(event.platformEventId, platform));
        }
      }

      // Batch mget in chunks of 100 to stay within Upstash request limits
      const CHUNK_SIZE = 100;
      const values: (ScrapedPrice | null)[] = [];
      for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
        const chunk = keys.slice(i, i + CHUNK_SIZE);
        const results = await redis.mget<ScrapedPrice>(...chunk);
        values.push(...results);
      }

      // Map results back: every KNOWN_PLATFORMS.length entries = 1 event
      const platformCount = KNOWN_PLATFORMS.length;

      return events.map((event, eventIdx) => {
        try {
          const platformPrices: PlatformPrice[] = [];

          // Include event's own priceRange first
          if (event.priceRange) {
            const defaultSource = event.platform === "seatgeek" ? "seatgeek" as const : "discovery-api" as const;
            platformPrices.push({
              platform: event.platform,
              min: event.priceRange.min,
              max: event.priceRange.max,
              currency: event.priceRange.currency,
              url: event.url,
              source: event.priceRange.source ?? defaultSource,
            });
          }

          // Add scraped prices from other platforms
          for (let pIdx = 0; pIdx < platformCount; pIdx++) {
            const platform = KNOWN_PLATFORMS[pIdx];
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
            platformPrices:
              platformPrices.length > 0 ? platformPrices : undefined,
          };
        } catch (err) {
          console.warn(`Price enrichment failed for ${event.platformEventId}: ${err}`);
          return event;
        }
      });
    },
  };
}
