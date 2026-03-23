import { describe, test, expect } from "bun:test";
import {
  deduplicateEvents,
  discoverForMonitor,
  discoverForScraper,
} from "./discovery";
import type { NormalizedEvent } from "./types";
import type { PlatformAdapter, PlatformResult } from "./platforms/types";
import type { ResolvedGeo } from "./config/geo";
import type { ApiBudgetStore } from "./state/api-budget";
import type { WatchlistConfig } from "./config/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    url: "https://example.com/event",
    platformPrices: [],
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<WatchlistConfig>): WatchlistConfig {
  return {
    settings: {
      email: "test@example.com",
      default_max_price: 200,
      alert_cooldown_hours: 6,
    },
    artists: [{ name: "Test Artist" }],
    events: [],
    ...overrides,
  };
}

function fakePlatform(
  events: NormalizedEvent[],
  apiCalls = 1
): PlatformAdapter {
  return {
    name: "ticketmaster",
    async searchEventsByArtist(
      _artist: string,
      _geo: ResolvedGeo
    ): Promise<PlatformResult<NormalizedEvent[]>> {
      return { data: events, apiCalls };
    },
    async searchEventsByKeyword(
      _keyword: string,
      _geo: ResolvedGeo
    ): Promise<PlatformResult<NormalizedEvent[]>> {
      return { data: events, apiCalls };
    },
    async getEventById(
      _id: string
    ): Promise<PlatformResult<NormalizedEvent | null>> {
      return { data: events[0] ?? null, apiCalls };
    },
  };
}

function fakeBudget(usedToday = 0) {
  const store = {
    total: usedToday,
    async getUsedToday() {
      return store.total;
    },
    async increment(by: number) {
      store.total += by;
    },
  };
  return store as unknown as ApiBudgetStore & { total: number };
}

// ---------------------------------------------------------------------------
// deduplicateEvents (existing tests)
// ---------------------------------------------------------------------------

describe("deduplicateEvents", () => {
  test("empty array → empty", () => {
    expect(deduplicateEvents([])).toEqual([]);
  });

  test("single event → returned as-is", () => {
    const events = [makeEvent()];
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  test("duplicate artist+venue+date keeps first", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", name: "First" }),
      makeEvent({ platformEventId: "ev2", name: "Second" }),
    ];
    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("First");
  });

  test("prefers event with priceRange over without", () => {
    const events = [
      makeEvent({ platformEventId: "ev1" }), // no price
      makeEvent({
        platformEventId: "ev2",
        priceRange: { min: 50, max: 100, currency: "USD" },
      }),
    ];
    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].priceRange).toBeDefined();
    expect(result[0].priceRange!.min).toBe(50);
  });

  test("keeps first if both have priceRange", () => {
    const events = [
      makeEvent({
        platformEventId: "ev1",
        priceRange: { min: 80, max: 120, currency: "USD" },
      }),
      makeEvent({
        platformEventId: "ev2",
        priceRange: { min: 50, max: 100, currency: "USD" },
      }),
    ];
    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].priceRange!.min).toBe(80);
  });

  test("case-insensitive artist and city matching", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", artistName: "TOOL", venueCity: "LOS ANGELES" }),
      makeEvent({ platformEventId: "ev2", artistName: "Tool", venueCity: "Los Angeles" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  test("different dates are not duplicates", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", date: "2026-06-15T20:00:00Z" }),
      makeEvent({ platformEventId: "ev2", date: "2026-06-16T20:00:00Z" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  test("different cities are not duplicates", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", venueCity: "Los Angeles" }),
      makeEvent({ platformEventId: "ev2", venueCity: "San Diego" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  test("same city different venues are deduplicated", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", venueName: "Agua Caliente Casino", venueCity: "Rancho Mirage" }),
      makeEvent({ platformEventId: "ev2", venueName: "Agua Caliente Casino - Rancho Mirage", venueCity: "Rancho Mirage" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(1);
  });

  test("prefers onsale over offsale when deduplicating", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", status: "offsale" }),
      makeEvent({ platformEventId: "ev2", status: "onsale" }),
    ];
    const result = deduplicateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("onsale");
  });

  test("different artists are not duplicates", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", artistName: "Artist A" }),
      makeEvent({ platformEventId: "ev2", artistName: "Artist B" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// discoverForMonitor
// ---------------------------------------------------------------------------

describe("discoverForMonitor", () => {
  test("returns watchHits, not events", async () => {
    const ev = makeEvent();
    const result = await discoverForMonitor({
      platforms: [fakePlatform([ev])],
      config: makeConfig(),
    });

    expect(result.watchHits).toBeDefined();
    expect(result.watchHits.length).toBeGreaterThan(0);
    expect((result as any).events).toBeUndefined();
  });

  test("budget is read and written internally", async () => {
    const ev = makeEvent();
    const budget = fakeBudget(100);

    const result = await discoverForMonitor({
      platforms: [fakePlatform([ev], 3)],
      apiBudget: budget,
      config: makeConfig(),
    });

    expect(result.apiCallsUsed).toBe(3);
    // Budget should have been incremented from 100 to 103
    expect(budget.total).toBe(103);
  });

  test("budget exhaustion returns early with error", async () => {
    const ev = makeEvent();
    const budget = fakeBudget(4500); // already at limit

    const result = await discoverForMonitor({
      platforms: [fakePlatform([ev])],
      apiBudget: budget,
      config: makeConfig(),
    });

    expect(result.watchHits).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Daily API limit reached");
    // Budget should NOT have been incremented (no calls made)
    expect(budget.total).toBe(4500);
  });

  test("works without apiBudget (optional)", async () => {
    const ev = makeEvent();

    const result = await discoverForMonitor({
      platforms: [fakePlatform([ev])],
      config: makeConfig(),
    });

    expect(result.watchHits.length).toBeGreaterThan(0);
    expect(result.apiCallsUsed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// discoverForScraper
// ---------------------------------------------------------------------------

describe("discoverForScraper", () => {
  test("returns deduplicated events, not watchHits", async () => {
    const ev = makeEvent();
    const result = await discoverForScraper({
      platforms: [fakePlatform([ev])],
      config: makeConfig(),
    });

    expect(result.events).toBeDefined();
    expect(result.events.length).toBeGreaterThan(0);
    expect((result as any).watchHits).toBeUndefined();
  });

  test("deduplicates events", async () => {
    // Two artists that return the same event → should deduplicate
    const ev = makeEvent();
    const config = makeConfig({
      artists: [{ name: "Test Artist" }, { name: "Test Artist 2" }],
    });

    // Platform returns same event for both artist searches
    const platform: PlatformAdapter = {
      name: "ticketmaster",
      async searchEventsByArtist() {
        return { data: [ev], apiCalls: 1 };
      },
      async searchEventsByKeyword() {
        return { data: [], apiCalls: 0 };
      },
      async getEventById() {
        return { data: null, apiCalls: 0 };
      },
    };

    const result = await discoverForScraper({
      platforms: [platform],
      config,
    });

    // Same artist+venue+date → deduplicated to 1
    expect(result.events).toHaveLength(1);
  });

  test("no budget interaction", async () => {
    const ev = makeEvent();
    // discoverForScraper doesn't accept apiBudget at all — just verify it works
    const result = await discoverForScraper({
      platforms: [fakePlatform([ev])],
      config: makeConfig(),
    });

    expect(result.events).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  test("returns apiCallsUsed", async () => {
    const ev = makeEvent();
    const result = await discoverForScraper({
      platforms: [fakePlatform([ev], 5)],
      config: makeConfig(),
    });

    expect(result.apiCallsUsed).toBe(5);
  });
});
