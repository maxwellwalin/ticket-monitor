import type { PlatformAdapter, PlatformResult } from "./types";
import type { ResolvedGeo } from "../config/geo";
import type { NormalizedEvent, Presale } from "../types";
import type { IAttractionCache } from "./ticketmaster/cache";
import type { RateLimiter } from "./rate-limiter";
import type {
  TmApiEvent,
  TmApiPresale,
} from "./ticketmaster/types";

const BASE_URL = "https://app.ticketmaster.com/discovery/v2";

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

interface TmSearchParams {
  keyword?: string;
  attractionId?: string;
  dmaId?: string;
  latlong?: string;
  radius?: string;
  unit?: string;
  stateCode?: string;
  countryCode?: string;
  size?: string;
  sort?: string;
}

export interface TicketmasterClientDeps {
  cache?: IAttractionCache;
  fetch?: typeof fetch;
  apiKey?: string;
  rateLimiter?: RateLimiter;
}

export class TicketmasterClient implements PlatformAdapter {
  name = "ticketmaster";

  private cache?: IAttractionCache;
  private fetchFn: typeof fetch;
  private apiKey: string;
  private rateLimiter?: RateLimiter;

  constructor(deps: TicketmasterClientDeps = {}) {
    this.cache = deps.cache;
    this.fetchFn = deps.fetch ?? globalThis.fetch;
    this.apiKey = deps.apiKey ?? process.env.TICKETMASTER_API_KEY!;
    this.rateLimiter = deps.rateLimiter;
  }

  // ── Public PlatformAdapter methods ─────────────────────────────

  async searchEventsByArtist(
    artistName: string,
    geo: ResolvedGeo
  ): Promise<PlatformResult<NormalizedEvent[]>> {
    let apiCalls = 0;

    // Try cache first
    let attractionId = await this.cache?.get(artistName) ?? null;

    if (!attractionId) {
      // Search attractions (1 API call)
      const attractions = await this.searchAttractions(artistName);
      apiCalls += 1;

      if (attractions.length === 0) {
        // Fallback to keyword search (1 more API call)
        const keywordResult = await this.searchEventsByKeyword(artistName, geo);
        return {
          data: keywordResult.data,
          apiCalls: apiCalls + keywordResult.apiCalls,
        };
      }

      attractionId = attractions[0].id;
      await this.cache?.set(artistName, attractionId);
    }

    // Search events by attraction (1 API call)
    const rawEvents = await this.fetchEvents({
      attractionId,
      ...resolvedGeoToTmParams(geo),
    });
    apiCalls += 1;

    const parsed = rawEvents.map((e) => this.parseEvent(e));
    return { data: parsed, apiCalls };
  }

  async searchEventsByKeyword(
    keyword: string,
    geo: ResolvedGeo
  ): Promise<PlatformResult<NormalizedEvent[]>> {
    const rawEvents = await this.fetchEvents({
      keyword,
      ...resolvedGeoToTmParams(geo),
    });
    const parsed = rawEvents.map((e) => this.parseEvent(e));
    return { data: parsed, apiCalls: 1 };
  }

  async getEventById(
    eventId: string
  ): Promise<PlatformResult<NormalizedEvent | null>> {
    const raw = await this.fetchEvent(eventId);
    if (!raw) return { data: null, apiCalls: 1 };
    return { data: this.parseEvent(raw), apiCalls: 1 };
  }

  // ── Private: API fetching ──────────────────────────────────────

  private async searchAttractions(
    keyword: string
  ): Promise<{ id: string; name: string }[]> {
    const url = this.buildUrl("/attractions.json", { keyword, size: "5" });
    const res = await this.rateLimitedFetch(url);
    const data: { _embedded?: { attractions?: { id: string; name: string }[] } } =
      await res.json();
    const attractions = data?._embedded?.attractions;
    if (!attractions) return [];
    return attractions.map((a) => ({
      id: a.id,
      name: a.name,
    }));
  }

  private async fetchEvents(params: TmSearchParams): Promise<TmApiEvent[]> {
    const url = this.buildUrl("/events.json", {
      keyword: params.keyword,
      attractionId: params.attractionId,
      dmaId: params.dmaId,
      latlong: params.latlong,
      radius: params.radius,
      unit: params.unit,
      stateCode: params.stateCode,
      countryCode: params.countryCode || "US",
      size: params.size || "50",
      sort: params.sort || "date,asc",
    });
    const res = await this.rateLimitedFetch(url);
    const data = await res.json();
    return (data?._embedded?.events as TmApiEvent[]) || [];
  }

  private async fetchEvent(eventId: string): Promise<TmApiEvent | null> {
    const url = this.buildUrl(`/events/${eventId}.json`, {});
    try {
      const res = await this.rateLimitedFetch(url);
      const json = await res.json();
      // Guard against error responses that aren't event objects
      if (!json?.id) return null;
      return json as TmApiEvent;
    } catch {
      return null;
    }
  }

  // ── Private: Rate limiter & URL builder ────────────────────────

  private async rateLimitedFetch(url: string): Promise<Response> {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    const res = await this.fetchFn(url);
    if (res.status === 429) {
      throw new Error("Ticketmaster rate limit exceeded");
    }
    if (!res.ok) {
      throw new Error(
        `Ticketmaster API error: ${res.status} ${res.statusText}`
      );
    }
    return res;
  }

  private buildUrl(
    path: string,
    params: Record<string, string | undefined>
  ): string {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("apikey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  // ── Private: Parsing ───────────────────────────────────────────

  private parseEvent(raw: TmApiEvent): NormalizedEvent {
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
      date:
        raw.dates?.start?.dateTime || raw.dates?.start?.localDate || "",
      status: this.parseStatus(raw.dates?.status?.code),
      url: raw.url || "",
      priceRange: priceRange
        ? {
            min: priceRange.min,
            max: priceRange.max,
            currency: priceRange.currency || "USD",
            source: "discovery-api" as const,
          }
        : undefined,
      publicSaleStart: raw.sales?.public?.startDateTime,
      presales: this.parsePresales(raw.sales?.presales),
    };
  }

  private parseStatus(raw: string | undefined): NormalizedEvent["status"] {
    const lower = raw?.toLowerCase() as TmStatus;
    return VALID_STATUSES.has(lower) ? lower : "unknown";
  }

  private parsePresales(presales: TmApiPresale[] | undefined): Presale[] {
    if (!Array.isArray(presales)) return [];
    return presales
      .filter((p) => p.startDateTime)
      .map((p) => ({
        name: p.name || "Presale",
        startDateTime: p.startDateTime!,
        endDateTime: p.endDateTime || "",
        url: p.url,
      }));
  }
}

// ── Geo helper (module-level, uses exhaustive switch) ──────────

function resolvedGeoToTmParams(
  geo: ResolvedGeo
): Pick<TmSearchParams, "latlong" | "radius" | "unit" | "stateCode" | "countryCode"> {
  switch (geo.kind) {
    case "latlong":
      return {
        latlong: `${geo.lat},${geo.lon}`,
        radius: String(geo.radiusMi),
        unit: "miles",
      };
    case "state":
      return {
        stateCode: geo.stateCode,
        countryCode: geo.countryCode,
      };
    case "none":
      return {};
    default: {
      const _exhaustive: never = geo;
      return _exhaustive;
    }
  }
}
