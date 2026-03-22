import type { IAttractionCache } from "../src/platforms/ticketmaster/cache";

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
