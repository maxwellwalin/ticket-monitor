import type { IAttractionCache } from "../src/platforms/ticketmaster/cache";
import { TicketmasterClient } from "../src/platforms/index";
import { SeatGeekClient } from "../src/platforms/seatgeek/index";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import type { PlatformAdapter } from "../src/platforms/types";

/** In-memory attraction cache for local script use (not backed by Redis). */
export class MemoryAttractionCache implements IAttractionCache {
  private map = new Map<string, string>();
  async get(name: string) {
    return this.map.get(name) ?? null;
  }
  async set(name: string, id: string, _ttlSec?: number) {
    this.map.set(name, id);
  }
}

/** Build platform adapters (TM always, SG if configured). */
export function createPlatforms(): PlatformAdapter[] {
  const platforms: PlatformAdapter[] = [
    new TicketmasterClient({
      cache: new MemoryAttractionCache(),
      rateLimiter: createRateLimiter(500),
    }),
  ];
  if (process.env.SEATGEEK_CLIENT_ID) {
    platforms.push(
      new SeatGeekClient({
        rateLimiter: createRateLimiter(200),
        performerCache: new MemoryAttractionCache(),
      })
    );
  }
  return platforms;
}

export const MAX_EVENTS = 20;
