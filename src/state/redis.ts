import { Redis } from "@upstash/redis";

/** Subset of @upstash/redis used by this app */
export interface RedisClient {
  get<T = unknown>(key: string): Promise<T | null>;
  mget<T = unknown>(...keys: string[]): Promise<(T | null)[]>;
  set(
    key: string,
    value: unknown,
    opts?: { ex?: number }
  ): Promise<string | null>;
  exists(...keys: string[]): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<0 | 1>;
}

export function createRedis(): RedisClient {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  // Redis class implements all RedisClient methods; structural subtyping handles the rest
  return redis as unknown as RedisClient;
}
