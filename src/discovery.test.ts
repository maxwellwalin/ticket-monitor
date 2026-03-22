import { describe, test, expect } from "bun:test";
import { deduplicateEvents } from "./discovery";
import type { NormalizedEvent } from "./types";

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
    ...overrides,
  };
}

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

  test("case-insensitive artist and venue matching", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", artistName: "TOOL", venueName: "THE FORUM" }),
      makeEvent({ platformEventId: "ev2", artistName: "Tool", venueName: "The Forum" }),
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

  test("different venues are not duplicates", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", venueName: "Venue A" }),
      makeEvent({ platformEventId: "ev2", venueName: "Venue B" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  test("different artists are not duplicates", () => {
    const events = [
      makeEvent({ platformEventId: "ev1", artistName: "Artist A" }),
      makeEvent({ platformEventId: "ev2", artistName: "Artist B" }),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });
});
