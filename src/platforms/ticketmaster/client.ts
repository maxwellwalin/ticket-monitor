import type { GeoFilter } from "../../config/schema";

const BASE_URL = "https://app.ticketmaster.com/discovery/v2";
const API_KEY = process.env.TICKETMASTER_API_KEY!;

// Simple rate limiter: max 2 req/sec with safety margin
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 550; // ~1.8 req/sec, well under 2/sec limit

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const res = await fetch(url);
  if (res.status === 429) {
    throw new Error("Ticketmaster rate limit exceeded");
  }
  if (!res.ok) {
    throw new Error(`Ticketmaster API error: ${res.status} ${res.statusText}`);
  }
  return res;
}

function buildUrl(
  path: string,
  params: Record<string, string | undefined>
): string {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apikey", API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export interface TmSearchParams {
  keyword?: string;
  attractionId?: string;
  dmaId?: string;
  stateCode?: string;
  countryCode?: string;
  size?: string;
  sort?: string;
}

export async function searchAttractions(
  keyword: string
): Promise<{ id: string; name: string }[]> {
  const url = buildUrl("/attractions.json", {
    keyword,
    size: "5",
  });
  const res = await rateLimitedFetch(url);
  const data = await res.json();
  const attractions = data?._embedded?.attractions;
  if (!attractions) return [];
  return attractions.map((a: any) => ({ id: a.id, name: a.name }));
}

export async function searchEvents(params: TmSearchParams): Promise<any[]> {
  const url = buildUrl("/events.json", {
    keyword: params.keyword,
    attractionId: params.attractionId,
    dmaId: params.dmaId,
    stateCode: params.stateCode,
    countryCode: params.countryCode || "US",
    size: params.size || "50",
    sort: params.sort || "date,asc",
  });
  const res = await rateLimitedFetch(url);
  const data = await res.json();
  return data?._embedded?.events || [];
}

export async function getEvent(eventId: string): Promise<any | null> {
  const url = buildUrl(`/events/${eventId}.json`, {});
  try {
    const res = await rateLimitedFetch(url);
    return await res.json();
  } catch {
    return null;
  }
}

export function geoToParams(
  geo?: GeoFilter
): Pick<TmSearchParams, "dmaId" | "stateCode" | "countryCode"> {
  if (!geo) return {};
  return {
    dmaId: geo.dma_id,
    stateCode: geo.state_code,
    countryCode: geo.country_code,
  };
}
