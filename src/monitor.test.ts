import { describe, test, expect } from "bun:test";
import { createMonitor } from "./monitor";
import type { MonitorDeps } from "./monitor";
import type { NormalizedEvent } from "./types";
import type { AlertStatePort, AlertSender } from "./alerts/ports";
import type { PlatformAdapter, PlatformResult } from "./platforms/types";
import type { ApiBudgetStore } from "./state/api-budget";
import type { PriceStore } from "./prices";
import type { ResolvedGeo } from "./config/geo";

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
    priceRange: { min: 80, max: 120, currency: "USD" },
    platformPrices: [],
    ...overrides,
  };
}

function fakePlatform(events: NormalizedEvent[]): PlatformAdapter {
  return {
    name: "fake" as any,
    searchEventsByArtist: async (
      _artist: string,
      _geo: ResolvedGeo
    ): Promise<PlatformResult<NormalizedEvent[]>> => ({
      data: events,
      apiCalls: 1,
    }),
    searchEventsByKeyword: async (
      _kw: string,
      _geo: ResolvedGeo
    ): Promise<PlatformResult<NormalizedEvent[]>> => ({
      data: events,
      apiCalls: 1,
    }),
    getEventById: async (
      _id: string
    ): Promise<PlatformResult<NormalizedEvent | null>> => ({
      data: events[0] ?? null,
      apiCalls: 1,
    }),
  };
}

function throwingPlatform(err: string): PlatformAdapter {
  return {
    name: "exploding" as any,
    searchEventsByArtist: async () => {
      throw new Error(err);
    },
    searchEventsByKeyword: async () => {
      throw new Error(err);
    },
    getEventById: async () => {
      throw new Error(err);
    },
  };
}

function fakeBudget(): ApiBudgetStore {
  return {
    getUsedToday: async () => 0,
    increment: async () => {},
  } as any;
}

const fakeAlertState: AlertStatePort = {
  hasAlerted: async () => false,
  markAlerted: async () => {},
  getStoredPrice: async () => null,
  storePrice: async () => {},
};

function fakeSender(): AlertSender & { calls: any[][] } {
  const calls: any[][] = [];
  return {
    calls,
    send: async (to: string, alerts: any[]) => {
      calls.push([to, alerts]);
    },
  };
}

function baseDeps(overrides: Partial<MonitorDeps> = {}): MonitorDeps {
  return {
    alertState: fakeAlertState,
    apiBudget: fakeBudget(),
    platforms: [fakePlatform([makeEvent()])],
    sender: fakeSender(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMonitor", () => {
  test("happy path: events with pricing trigger alerts", async () => {
    const sender = fakeSender();
    const deps = baseDeps({ sender });
    const result = await createMonitor(deps).run();

    expect(result.eventsChecked).toBeGreaterThan(0);
    expect(result.alertsSent).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
    expect(sender.calls.length).toBeGreaterThan(0);
  });

  test("sender throw produces error in result, not an uncaught exception", async () => {
    const throwingSender: AlertSender = {
      send: async () => {
        throw new Error("SMTP down");
      },
    };
    const deps = baseDeps({ sender: throwingSender });
    const result = await createMonitor(deps).run();

    // Engine.flush sends before marking — on send failure, returns error in flushResult.errors
    const hasError = result.errors.some((e) => e.includes("SMTP down"));
    expect(hasError).toBe(true);
    expect(result.alertsSent).toBe(0);
    expect(result.eventsChecked).toBeGreaterThan(0);
  });

  test("enrichment skip: priceStore undefined still produces alerts", async () => {
    const sender = fakeSender();
    const deps = baseDeps({ sender, priceStore: undefined });
    const result = await createMonitor(deps).run();

    expect(result.eventsChecked).toBeGreaterThan(0);
    expect(result.alertsSent).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  test("empty discovery: no events, no alerts", async () => {
    const sender = fakeSender();
    const deps = baseDeps({
      sender,
      platforms: [fakePlatform([])],
    });
    const result = await createMonitor(deps).run();

    expect(result.eventsChecked).toBe(0);
    expect(result.alertsSent).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  test("partial failure: one platform throws, another succeeds", async () => {
    const sender = fakeSender();
    const deps = baseDeps({
      sender,
      platforms: [throwingPlatform("API timeout"), fakePlatform([makeEvent()])],
    });
    const result = await createMonitor(deps).run();

    // Should have errors from the throwing platform
    const hasApiError = result.errors.some((e) => e.includes("API timeout"));
    expect(hasApiError).toBe(true);
    // Should still have processed events from the working platform
    expect(result.eventsChecked).toBeGreaterThan(0);
  });
});
