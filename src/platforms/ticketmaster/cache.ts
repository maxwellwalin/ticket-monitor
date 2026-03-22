import type { RedisClient } from "../../state/redis";

function cacheKey(prefix: string, name: string): string {
  return `${prefix}:${name.toLowerCase().replace(/\s+/g, "-")}`;
}

export interface IAttractionCache {
  get(name: string): Promise<string | null>;
  set(name: string, id: string, ttlSec?: number): Promise<void>;
}

export class AttractionCache implements IAttractionCache {
  private prefix: string;

  constructor(private redis: RedisClient, platform: string = "tm") {
    this.prefix = `attraction:${platform}`;
  }

  async get(name: string): Promise<string | null> {
    return this.redis.get<string>(cacheKey(this.prefix, name));
  }

  async set(name: string, id: string, ttlSec: number = 86400): Promise<void> {
    await this.redis.set(cacheKey(this.prefix, name), id, { ex: ttlSec });
  }
}
