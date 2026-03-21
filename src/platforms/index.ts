import type { PlatformAdapter } from "./types";
import type { GeoFilter } from "../config/schema";
import type { NormalizedEvent } from "../types";
import {
  searchAttractions,
  searchEvents,
  getEvent,
  geoToParams,
} from "./ticketmaster/client";
import { parseTmEvent, parseTmEvents } from "./ticketmaster/parser";
import type { IAttractionCache } from "./ticketmaster/cache";

export class TicketmasterAdapter implements PlatformAdapter {
  name = "ticketmaster";

  constructor(private cache: IAttractionCache) {}

  async searchEventsByArtist(
    artistName: string,
    geo?: GeoFilter
  ): Promise<NormalizedEvent[]> {
    let attractionId = await this.cache.get(artistName);

    if (!attractionId) {
      const attractions = await searchAttractions(artistName);
      if (attractions.length === 0) {
        return this.searchEventsByKeyword(artistName, geo);
      }
      attractionId = attractions[0].id;
      await this.cache.set(artistName, attractionId);
    }

    const rawEvents = await searchEvents({
      attractionId,
      ...geoToParams(geo),
    });
    return parseTmEvents(rawEvents);
  }

  async searchEventsByKeyword(
    keyword: string,
    geo?: GeoFilter
  ): Promise<NormalizedEvent[]> {
    const rawEvents = await searchEvents({
      keyword,
      ...geoToParams(geo),
    });
    return parseTmEvents(rawEvents);
  }

  async getEventById(eventId: string): Promise<NormalizedEvent | null> {
    const raw = await getEvent(eventId);
    if (!raw) return null;
    return parseTmEvent(raw);
  }
}
