import type { NormalizedEvent } from "../types";
import type { GeoFilter } from "../config/schema";

export interface PlatformAdapter {
  name: string;
  searchEventsByArtist(
    artistName: string,
    geo?: GeoFilter
  ): Promise<NormalizedEvent[]>;
  searchEventsByKeyword(
    keyword: string,
    geo?: GeoFilter
  ): Promise<NormalizedEvent[]>;
  getEventById(eventId: string): Promise<NormalizedEvent | null>;
}
