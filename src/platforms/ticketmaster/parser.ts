import type { NormalizedEvent, Presale } from "../../types";

type TmStatus =
  | "onsale"
  | "offsale"
  | "canceled"
  | "postponed"
  | "rescheduled";

const VALID_STATUSES = new Set<TmStatus>([
  "onsale",
  "offsale",
  "canceled",
  "postponed",
  "rescheduled",
]);

function parseStatus(raw: string | undefined): NormalizedEvent["status"] {
  const lower = raw?.toLowerCase() as TmStatus;
  return VALID_STATUSES.has(lower) ? lower : "unknown";
}

function parsePresales(raw: any): Presale[] {
  const presales = raw?.sales?.presales;
  if (!Array.isArray(presales)) return [];
  return presales
    .filter((p: any) => p.startDateTime)
    .map((p: any) => ({
      name: p.name || "Presale",
      startDateTime: p.startDateTime,
      endDateTime: p.endDateTime || "",
      url: p.url,
    }));
}

export function parseTmEvent(raw: any): NormalizedEvent {
  const venue = raw._embedded?.venues?.[0];
  const attraction = raw._embedded?.attractions?.[0];
  const priceRange = raw.priceRanges?.[0];

  return {
    platformEventId: raw.id,
    platform: "ticketmaster",
    name: raw.name,
    artistName: attraction?.name || raw.name,
    venueName: venue?.name || "Unknown Venue",
    venueCity: venue?.city?.name || "Unknown City",
    date: raw.dates?.start?.dateTime || raw.dates?.start?.localDate || "",
    status: parseStatus(raw.dates?.status?.code),
    url: raw.url || "",
    priceRange: priceRange
      ? {
          min: priceRange.min,
          max: priceRange.max,
          currency: priceRange.currency || "USD",
        }
      : undefined,
    publicSaleStart: raw?.sales?.public?.startDateTime,
    presales: parsePresales(raw),
  };
}

export function parseTmEvents(rawEvents: any[]): NormalizedEvent[] {
  return rawEvents.map(parseTmEvent);
}
