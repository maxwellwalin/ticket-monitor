import type { NormalizedEvent } from "../types";
import type { ResolvedGeo } from "../config/geo";

export interface PlatformResult<T> {
  data: T;
  apiCalls: number;
}

export interface PlatformAdapter {
  name: string;
  searchEventsByArtist(
    artistName: string,
    geo: ResolvedGeo
  ): Promise<PlatformResult<NormalizedEvent[]>>;
  searchEventsByKeyword(
    keyword: string,
    geo: ResolvedGeo
  ): Promise<PlatformResult<NormalizedEvent[]>>;
  getEventById(eventId: string): Promise<PlatformResult<NormalizedEvent | null>>;
}
