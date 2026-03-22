import type { PlatformAdapter, PlatformResult } from "../types";
import type { ResolvedGeo } from "../../config/geo";
import type { NormalizedEvent } from "../../types";
import type { RateLimiter } from "../rate-limiter";
import type { IAttractionCache } from "../ticketmaster/cache";
import type {
  SgApiEvent,
  SgApiEventsResponse,
  SgApiPerformersResponse,
} from "./types";

const BASE_URL = "https://api.seatgeek.com/2";

export interface SeatGeekClientDeps {
  fetch?: typeof fetch;
  clientId?: string;
  rateLimiter?: RateLimiter;
  /** Performer ID cache — same interface as TM attraction cache */
  performerCache?: IAttractionCache;
}

export class SeatGeekClient implements PlatformAdapter {
  name = "seatgeek";

  private fetchFn: typeof fetch;
  private clientId: string;
  private rateLimiter?: RateLimiter;
  private performerCache?: IAttractionCache;

  constructor(deps: SeatGeekClientDeps = {}) {
    this.fetchFn = deps.fetch ?? globalThis.fetch;
    this.clientId = deps.clientId ?? process.env.SEATGEEK_CLIENT_ID!;
    this.rateLimiter = deps.rateLimiter;
    this.performerCache = deps.performerCache;
  }

  // ── Public PlatformAdapter methods ─────────────────────────────

  async searchEventsByArtist(
    artistName: string,
    geo: ResolvedGeo
  ): Promise<PlatformResult<NormalizedEvent[]>> {
    let apiCalls = 0;

    // Try performer cache first (same pattern as TM attraction cache)
    let performerId = await this.performerCache?.get(artistName) ?? null;

    if (!performerId) {
      const performersUrl = this.buildUrl("/performers", {
        q: artistName,
        per_page: "5",
      });
      const performersRes = await this.rateLimitedFetch(performersUrl);
      const performersData: SgApiPerformersResponse = await performersRes.json();
      apiCalls += 1;

      if (!performersData.performers || performersData.performers.length === 0) {
        // Fallback to keyword search
        const keywordResult = await this.searchEventsByKeyword(artistName, geo);
        return {
          data: keywordResult.data,
          apiCalls: apiCalls + keywordResult.apiCalls,
        };
      }

      performerId = String(performersData.performers[0].id);
      await this.performerCache?.set(artistName, performerId);
    }

    // Search events by performer ID
    const eventsUrl = this.buildUrl("/events", {
      "performers.id": performerId,
      per_page: "100",
      sort: "datetime_utc.asc",
      ...resolvedGeoToSgParams(geo),
    });
    const eventsRes = await this.rateLimitedFetch(eventsUrl);
    const eventsData: SgApiEventsResponse = await eventsRes.json();
    apiCalls += 1;

    const events = (eventsData.events || []).map((e) => this.parseEvent(e));
    return { data: events, apiCalls };
  }

  async searchEventsByKeyword(
    keyword: string,
    geo: ResolvedGeo
  ): Promise<PlatformResult<NormalizedEvent[]>> {
    const url = this.buildUrl("/events", {
      q: keyword,
      per_page: "100",
      sort: "datetime_utc.asc",
      ...resolvedGeoToSgParams(geo),
    });
    const res = await this.rateLimitedFetch(url);
    const data: SgApiEventsResponse = await res.json();
    const events = (data.events || []).map((e) => this.parseEvent(e));
    return { data: events, apiCalls: 1 };
  }

  async getEventById(
    eventId: string
  ): Promise<PlatformResult<NormalizedEvent | null>> {
    const url = this.buildUrl(`/events/${eventId}`, {});
    try {
      const res = await this.rateLimitedFetch(url);
      const event: SgApiEvent = await res.json();
      if (!event?.id) return { data: null, apiCalls: 1 };
      return { data: this.parseEvent(event), apiCalls: 1 };
    } catch {
      return { data: null, apiCalls: 1 };
    }
  }

  // ── Private: Rate limiter & URL builder ────────────────────────

  private async rateLimitedFetch(url: string): Promise<Response> {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    const res = await this.fetchFn(url);
    if (res.status === 429) {
      throw new Error("SeatGeek rate limit exceeded");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SeatGeek API error: ${res.status} ${res.statusText} - ${body.slice(0, 200)}`);
    }
    return res;
  }

  private buildUrl(
    path: string,
    params: Record<string, string | undefined>
  ): string {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("client_id", this.clientId);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  // ── Private: Parsing ───────────────────────────────────────────

  private parseEvent(raw: SgApiEvent): NormalizedEvent {
    const primaryPerformer = raw.performers?.find((p) => p.primary);
    const firstPerformer = raw.performers?.[0];

    let priceRange: NormalizedEvent["priceRange"];
    if (raw.stats?.lowest_price != null && raw.stats?.highest_price != null) {
      priceRange = {
        min: raw.stats.lowest_price,
        max: raw.stats.highest_price,
        currency: "USD",
        source: "seatgeek" as const,
      };
    }

    return {
      platformEventId: String(raw.id),
      platform: "seatgeek",
      name: raw.title,
      artistName: primaryPerformer?.name ?? firstPerformer?.name ?? raw.title,
      venueName: raw.venue?.name ?? "Unknown Venue",
      venueCity: raw.venue?.city ?? "Unknown City",
      date: raw.datetime_utc.endsWith("Z") ? raw.datetime_utc : raw.datetime_utc + "Z",
      status: this.parseStatus(raw),
      url: raw.url,
      priceRange,
    };
  }

  private parseStatus(raw: SgApiEvent): NormalizedEvent["status"] {
    if (raw.status === "canceled") return "canceled";
    if (raw.status === "postponed") return "postponed";
    if (raw.status === "rescheduled") return "rescheduled";
    if (raw.is_open === true) return "onsale";
    if (raw.is_open === false) return "offsale";
    return "unknown";
  }
}

// ── Geo helper (module-level, uses exhaustive switch) ──────────

function resolvedGeoToSgParams(
  geo: ResolvedGeo
): Record<string, string | undefined> {
  switch (geo.kind) {
    case "latlong":
      return {
        lat: String(geo.lat),
        lon: String(geo.lon),
        range: `${geo.radiusMi}mi`,
      };
    case "state":
      return {
        "venue.state": geo.stateCode,
        "venue.country": geo.countryCode,
      };
    case "none":
      return {};
    default: {
      const _exhaustive: never = geo;
      return _exhaustive;
    }
  }
}
