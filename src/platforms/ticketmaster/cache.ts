import type { RedisClient } from "../../state/redis";

const ATTRACTION_PREFIX = "attraction";

function attractionKey(name: string): string {
  return `${ATTRACTION_PREFIX}:${name.toLowerCase().replace(/\s+/g, "-")}`;
}

export interface IAttractionCache {
  get(name: string): Promise<string | null>;
  set(name: string, id: string, ttlSec?: number): Promise<void>;
}

export class AttractionCache implements IAttractionCache {
  constructor(private redis: RedisClient) {}

  async get(name: string): Promise<string | null> {
    return this.redis.get<string>(attractionKey(name));
  }

  async set(name: string, id: string, ttlSec: number = 86400): Promise<void> {
    await this.redis.set(attractionKey(name), id, { ex: ttlSec });
  }
}
