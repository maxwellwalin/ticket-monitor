import { describe, test, expect } from "bun:test";
import { priceBelowRule } from "./price-below";
import { priceDropRule } from "./price-drop";
import { presaleOpeningRule } from "./presale-opening";
import { ticketsAvailableRule } from "./tickets-available";
import type { NormalizedEvent, AlertPayload } from "../../types";
import type { AlertStatePort, AlertSender, AlertCheckContext, Clock } from "../ports";
import { AlertEngine } from "../engine";

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

const ctx: AlertCheckContext = { watchName: "Test Artist", maxPrice: 100 };

const nullState: AlertStatePort = {
  hasAlerted: async () => false,
  markAlerted: async () => {},
  getStoredPrice: async () => null,
  storePrice: async () => {},
};

const fixedClock: Clock = { now: () => new Date("2026-06-15T12:00:00Z").getTime() };

// ── priceBelowRule ─────────────────────────────────────────

describe("priceBelowRule", () => {
  test("matches when onsale + API price ≤ maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD", source: "discovery-api" },
    });
    const matches = await priceBelowRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(1);
  });

  test("matches when price equals maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 100, max: 150, currency: "USD" },
    });
    const matches = await priceBelowRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(1);
  });

  test("no match when price > maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 150, max: 200, currency: "USD" },
    });
    const matches = await priceBelowRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when status is not onsale", async () => {
    const event = makeEvent({
      status: "offsale",
      priceRange: { min: 50, max: 100, currency: "USD" },
    });
    const matches = await priceBelowRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when no priceRange", async () => {
    const matches = await priceBelowRule.evaluate(makeEvent(), ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when source is scraped", async () => {
    const event = makeEvent({
      priceRange: { min: 50, max: 100, currency: "USD", source: "scraped" },
    });
    const matches = await priceBelowRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("detail shows platformPrices when available", async () => {
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD" },
      platformPrices: [
        { platform: "stubhub", min: 70, max: 120, currency: "USD", url: "", source: "scraped" },
      ],
    });
    const matches = await priceBelowRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches[0].detail).toContain("$70");
    expect(matches[0].detail).toContain("StubHub");
  });

  test("suppresses includes price_drop", () => {
    expect(priceBelowRule.suppresses).toContain("price_drop");
  });
});

// ── priceDropRule ──────────────────────────────────────────

describe("priceDropRule", () => {
  test("matches when price dropped below stored and ≤ maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD" },
    });
    const state: AlertStatePort = {
      ...nullState,
      getStoredPrice: async () => ({ min: 120, max: 200, timestamp: "2026-01-01T00:00:00Z" }),
    };
    const matches = await priceDropRule.evaluate(event, ctx, state, fixedClock);
    expect(matches).toHaveLength(1);
    expect(matches[0].detail).toContain("$120");
    expect(matches[0].detail).toContain("$80");
  });

  test("no match when no stored price", async () => {
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD" },
    });
    const matches = await priceDropRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when price increased", async () => {
    const event = makeEvent({
      priceRange: { min: 150, max: 200, currency: "USD" },
    });
    const state: AlertStatePort = {
      ...nullState,
      getStoredPrice: async () => ({ min: 120, max: 200, timestamp: "2026-01-01T00:00:00Z" }),
    };
    const matches = await priceDropRule.evaluate(event, ctx, state, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when price same as stored", async () => {
    const event = makeEvent({
      priceRange: { min: 120, max: 200, currency: "USD" },
    });
    const state: AlertStatePort = {
      ...nullState,
      getStoredPrice: async () => ({ min: 120, max: 200, timestamp: "2026-01-01T00:00:00Z" }),
    };
    const matches = await priceDropRule.evaluate(event, ctx, state, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when dropped but still > maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 110, max: 200, currency: "USD" },
    });
    const state: AlertStatePort = {
      ...nullState,
      getStoredPrice: async () => ({ min: 150, max: 200, timestamp: "2026-01-01T00:00:00Z" }),
    };
    const matches = await priceDropRule.evaluate(event, ctx, state, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when no priceRange", async () => {
    const matches = await priceDropRule.evaluate(makeEvent(), ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });
});

// ── presaleOpeningRule ─────────────────────────────────────

describe("presaleOpeningRule", () => {
  test("no presales → no match", async () => {
    const matches = await presaleOpeningRule.evaluate(makeEvent(), ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("empty presales → no match", async () => {
    const event = makeEvent({ presales: [] });
    const matches = await presaleOpeningRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("presale within 24h → matches", async () => {
    const event = makeEvent({
      presales: [
        {
          name: "Citi Presale",
          startDateTime: "2026-06-15T20:00:00Z", // 8h from fixedClock
          endDateTime: "2026-06-16T20:00:00Z",
        },
      ],
    });
    const matches = await presaleOpeningRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(1);
    expect(matches[0].detail).toContain("Citi Presale");
    expect(matches[0].detail).toContain("opens in");
  });

  test("presale > 24h away → no match", async () => {
    const event = makeEvent({
      presales: [
        {
          name: "Far Away",
          startDateTime: "2026-06-17T12:00:00Z", // 48h from fixedClock
          endDateTime: "2026-06-18T12:00:00Z",
        },
      ],
    });
    const matches = await presaleOpeningRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("presale just started (within 1h grace) → LIVE NOW", async () => {
    const event = makeEvent({
      presales: [
        {
          name: "Live Sale",
          startDateTime: "2026-06-15T11:30:00Z", // 30min ago
          endDateTime: "2026-06-16T11:30:00Z",
        },
      ],
    });
    const matches = await presaleOpeningRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(1);
    expect(matches[0].detail).toContain("LIVE NOW");
  });

  test("presale > 1h past → no match", async () => {
    const event = makeEvent({
      presales: [
        {
          name: "Old Sale",
          startDateTime: "2026-06-15T10:00:00Z", // 2h ago
          endDateTime: "2026-06-16T10:00:00Z",
        },
      ],
    });
    const matches = await presaleOpeningRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("multiple presales, some match some don't", async () => {
    const event = makeEvent({
      presales: [
        {
          name: "Soon",
          startDateTime: "2026-06-15T20:00:00Z", // 8h, matches
          endDateTime: "2026-06-16T20:00:00Z",
        },
        {
          name: "Far",
          startDateTime: "2026-06-20T12:00:00Z", // 5 days, no match
          endDateTime: "2026-06-21T12:00:00Z",
        },
      ],
    });
    const matches = await presaleOpeningRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(1);
    expect(matches[0].detail).toContain("Soon");
  });

  test("dedupDiscriminator returns presale name slug", () => {
    const event = makeEvent();
    const match = { detail: "test", meta: { presaleName: "Citi Presale" } };
    expect(presaleOpeningRule.dedupDiscriminator!(event, match, ctx)).toBe(
      "citi-presale"
    );
  });
});

// ── ticketsAvailableRule ───────────────────────────────────

describe("ticketsAvailableRule", () => {
  test("matches when source is scraped and price ≤ maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD", source: "scraped" },
    });
    const matches = await ticketsAvailableRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(1);
  });

  test("no match when source is discovery-api", async () => {
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD", source: "discovery-api" },
    });
    const matches = await ticketsAvailableRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when no priceRange", async () => {
    const matches = await ticketsAvailableRule.evaluate(makeEvent(), ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("no match when scraped price > maxPrice", async () => {
    const event = makeEvent({
      priceRange: { min: 150, max: 200, currency: "USD", source: "scraped" },
    });
    const matches = await ticketsAvailableRule.evaluate(event, ctx, nullState, fixedClock);
    expect(matches).toHaveLength(0);
  });

  test("suppresses includes price_below and price_drop", () => {
    expect(ticketsAvailableRule.suppresses).toContain("price_below");
    expect(ticketsAvailableRule.suppresses).toContain("price_drop");
  });
});

// ── AlertEngine ──────────────────────────────────────────

const nullSender: AlertSender = { send: async () => {} };

describe("AlertEngine", () => {
  test("priority-based evaluation order: tickets_available suppresses price_below/price_drop", async () => {
    // Pass rules in WRONG order (low priority first)
    const engine = new AlertEngine(nullState, nullSender, [priceDropRule, priceBelowRule, ticketsAvailableRule, presaleOpeningRule], fixedClock);
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD", source: "scraped" },
    });
    const alerts = await engine.detect([event], ctx);
    // Only tickets_available should fire; price_below and price_drop suppressed
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("tickets_available");
  });

  test("centralized dedup key: price_below uses alert namespace", async () => {
    const engine = new AlertEngine(nullState, nullSender, [priceBelowRule], fixedClock);
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD", source: "discovery-api" },
    });
    const alerts = await engine.detect([event], ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dedupKey).toBe("alert:ev1:100");
  });

  test("centralized dedup key: presale_opening uses presale namespace + slug", async () => {
    const engine = new AlertEngine(nullState, nullSender, [presaleOpeningRule], fixedClock);
    const event = makeEvent({
      presales: [
        {
          name: "Citi Presale",
          startDateTime: "2026-06-15T20:00:00Z",
          endDateTime: "2026-06-16T20:00:00Z",
        },
      ],
    });
    const alerts = await engine.detect([event], ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dedupKey).toBe("presale:ev1:citi-presale");
  });

  test("send-before-mark: email failure prevents markAlerted", async () => {
    const markCalls: string[] = [];
    const trackingState: AlertStatePort = {
      ...nullState,
      markAlerted: async (key) => { markCalls.push(key); },
    };
    const failingSender: AlertSender = {
      send: async () => { throw new Error("SMTP down"); },
    };
    const engine = new AlertEngine(trackingState, failingSender, [], fixedClock);
    const alerts: AlertPayload[] = [
      {
        type: "price_below",
        event: makeEvent(),
        watchName: "Test",
        maxPrice: 100,
        dedupKey: "alert:ev1:100",
      },
    ];
    const result = await engine.flush(alerts, "test@example.com", 3600);
    expect(markCalls).toHaveLength(0);
    expect(result.sent).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Email send failed");
  });

  test("send-before-mark: email success marks all alerts", async () => {
    const markCalls: string[] = [];
    const trackingState: AlertStatePort = {
      ...nullState,
      markAlerted: async (key) => { markCalls.push(key); },
    };
    const engine = new AlertEngine(trackingState, nullSender, [], fixedClock);
    const alerts: AlertPayload[] = [
      {
        type: "price_below",
        event: makeEvent(),
        watchName: "Test",
        maxPrice: 100,
        dedupKey: "alert:ev1:100",
      },
      {
        type: "presale_opening",
        event: makeEvent(),
        watchName: "Test",
        maxPrice: 100,
        dedupKey: "presale:ev1:citi",
      },
    ];
    const result = await engine.flush(alerts, "test@example.com", 3600);
    expect(result.sent).toBe(2);
    expect(result.markedInState).toBe(2);
    expect(markCalls).toEqual(["alert:ev1:100", "presale:ev1:citi"]);
    expect(result.errors).toHaveLength(0);
  });

  test("price update dedup: storePrice called once per unique eventId across detect() calls", async () => {
    const storeCalls: string[] = [];
    const trackingState: AlertStatePort = {
      ...nullState,
      storePrice: async (eventId) => { storeCalls.push(eventId); },
    };
    const engine = new AlertEngine(trackingState, nullSender, [priceBelowRule], fixedClock);
    const event = makeEvent({
      priceRange: { min: 80, max: 150, currency: "USD", source: "discovery-api" },
    });

    await engine.detect([event], ctx);
    await engine.detect([event], ctx);

    expect(storeCalls).toEqual(["ev1"]);
  });
});
