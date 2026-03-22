import { describe, test, expect } from "bun:test";
import { createPriceStore, KNOWN_PLATFORMS } from "./index";
import type { NormalizedEvent } from "../types";

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platformEventId: "ev1",
    platform: "ticketmaster",
    name: "Test Event",
    artistName: "Test Artist",
    venueName: "Test Venue",
    venueCity: "Los Angeles",
    date: "2026-06-15T20:00:00Z",
    status: "onsale",
    url: "https://ticketmaster.com/event/ev1",
    ...overrides,
  };
}

/** Fake Redis that returns pre-configured values for mget */
function fakeRedis(priceMap: Record<string, any> = {}) {
  return {
    set: async () => {},
    get: async (k: string) => priceMap[k] ?? null,
    mget: async (...keys: string[]) => keys.map((k) => priceMap[k] ?? null),
    keys: async () => [],
  } as any;
}

describe("enrichAll", () => {
  test("empty events → empty", async () => {
    const store = createPriceStore(fakeRedis());
    expect(await store.enrichAll([])).toEqual([]);
  });

  test("no scraped prices → event unchanged", async () => {
    const store = createPriceStore(fakeRedis());
    const events = [makeEvent()];
    const result = await store.enrichAll(events);
    expect(result[0].platformPrices).toBeUndefined();
    expect(result[0].priceRange).toBeUndefined();
  });

  test("event with API price + scraped prices from other platforms", async () => {
    const event = makeEvent({
      priceRange: { min: 100, max: 200, currency: "USD" },
    });
    const store = createPriceStore(
      fakeRedis({
        "scraped-price:v1:stubhub:ev1": {
          min: 80,
          max: 150,
          currency: "USD",
          url: "https://stubhub.com/ev1",
          scrapedAt: "2026-01-01T00:00:00Z",
        },
      })
    );
    const result = await store.enrichAll([event]);
    expect(result[0].platformPrices).toHaveLength(2);
    // Sorted by min ascending — StubHub $80 first, TM $100 second
    expect(result[0].platformPrices![0].platform).toBe("stubhub");
    expect(result[0].platformPrices![0].min).toBe(80);
    expect(result[0].platformPrices![1].platform).toBe("ticketmaster");
  });

  test("skips same-platform scraped price when API price exists", async () => {
    const event = makeEvent({
      priceRange: { min: 100, max: 200, currency: "USD" },
    });
    const store = createPriceStore(
      fakeRedis({
        "scraped-price:v1:ticketmaster:ev1": {
          min: 75,
          max: 300,
          currency: "USD",
          scrapedAt: "2026-01-01T00:00:00Z",
        },
      })
    );
    const result = await store.enrichAll([event]);
    // Only the API price, scraped TM price is skipped
    expect(result[0].platformPrices).toHaveLength(1);
    expect(result[0].platformPrices![0].source).toBe("discovery-api");
  });

  test("includes same-platform scraped price when API price is MISSING", async () => {
    const event = makeEvent(); // no priceRange
    const store = createPriceStore(
      fakeRedis({
        "scraped-price:v1:ticketmaster:ev1": {
          min: 75,
          max: 300,
          currency: "USD",
          scrapedAt: "2026-01-01T00:00:00Z",
        },
      })
    );
    const result = await store.enrichAll([event]);
    expect(result[0].platformPrices).toHaveLength(1);
    expect(result[0].platformPrices![0].platform).toBe("ticketmaster");
    expect(result[0].platformPrices![0].min).toBe(75);
    // priceRange should be set from best scraped price
    expect(result[0].priceRange).toBeDefined();
    expect(result[0].priceRange!.min).toBe(75);
    expect(result[0].priceRange!.source).toBe("scraped");
  });

  test("no priceRange + scraped prices → uses best as priceRange", async () => {
    const event = makeEvent(); // no priceRange
    const store = createPriceStore(
      fakeRedis({
        "scraped-price:v1:stubhub:ev1": {
          min: 120,
          max: 200,
          currency: "USD",
          url: "https://stubhub.com/ev1",
          scrapedAt: "2026-01-01T00:00:00Z",
        },
        "scraped-price:v1:vividseats:ev1": {
          min: 90,
          max: 180,
          currency: "USD",
          url: "https://vividseats.com/ev1",
          scrapedAt: "2026-01-01T00:00:00Z",
        },
      })
    );
    const result = await store.enrichAll([event]);
    expect(result[0].priceRange!.min).toBe(90); // best = Vivid Seats
    expect(result[0].priceRange!.source).toBe("scraped");
    expect(result[0].platformPrices).toHaveLength(2);
    expect(result[0].platformPrices![0].platform).toBe("vividseats"); // sorted cheapest first
  });

  test("SeatGeek event uses seatgeek source label", async () => {
    const event = makeEvent({
      platform: "seatgeek",
      priceRange: { min: 50, max: 100, currency: "USD" },
    });
    const store = createPriceStore(fakeRedis());
    const result = await store.enrichAll([event]);
    expect(result[0].platformPrices![0].source).toBe("seatgeek");
  });

  test("URL fallback to search URL when scraped price has no url", async () => {
    const event = makeEvent({ name: "Cool Show" });
    const store = createPriceStore(
      fakeRedis({
        "scraped-price:v1:stubhub:ev1": {
          min: 80,
          max: 150,
          currency: "USD",
          scrapedAt: "2026-01-01T00:00:00Z",
          // no url field
        },
      })
    );
    const result = await store.enrichAll([event]);
    expect(result[0].platformPrices![0].url).toContain("stubhub.com/search");
    expect(result[0].platformPrices![0].url).toContain("Cool%20Show");
  });
});
