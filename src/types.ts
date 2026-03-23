export type PlatformName =
  | "ticketmaster"
  | "seatgeek"
  | "stubhub"
  | "vividseats";

export const PLATFORMS = ["ticketmaster", "seatgeek", "stubhub", "vividseats"] as const satisfies readonly PlatformName[];

export interface PlatformPrice {
  platform: PlatformName;
  min: number;
  max: number;
  currency: string;
  url: string;
  source: "discovery-api" | "seatgeek" | "scraped";
}

export interface Presale {
  name: string;
  startDateTime: string; // ISO 8601
  endDateTime: string;
  url?: string;
}

export interface NormalizedEvent {
  platformEventId: string;
  platform: PlatformName;
  name: string;
  artistName: string;
  venueName: string;
  venueCity: string;
  date: string; // ISO 8601
  status:
    | "onsale"
    | "offsale"
    | "canceled"
    | "postponed"
    | "rescheduled"
    | "unknown";
  url: string;
  priceRange?: {
    min: number;
    max: number;
    currency: string;
    source?: "discovery-api" | "seatgeek" | "scraped";
  };
  publicSaleStart?: string; // ISO 8601
  presales?: Presale[];
  platformPrices: PlatformPrice[];
}

export type AlertType =
  | "price_below"
  | "presale_opening"
  | "price_drop"
  | "tickets_available";

export interface AlertPayload {
  type: AlertType;
  event: NormalizedEvent;
  watchName: string;
  maxPrice: number;
  detail?: string; // e.g. "Citi Presale — opens in 2h" or "Price dropped $150 → $89"
  dedupKey: string; // full Redis key for send-before-mark
}
