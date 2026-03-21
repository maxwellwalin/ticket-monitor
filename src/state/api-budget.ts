import type { RedisClient } from "./redis";

const API_CALLS_PREFIX = "api_calls";

function apiCallsKey(): string {
  const date = new Date().toISOString().split("T")[0];
  return `${API_CALLS_PREFIX}:${date}`;
}

export class ApiBudgetStore {
  constructor(private redis: RedisClient) {}

  async getUsedToday(): Promise<number> {
    const count = await this.redis.get<number>(apiCallsKey());
    return count ?? 0;
  }

  async increment(by: number = 1): Promise<void> {
    const key = apiCallsKey();
    await this.redis.incrby(key, by);
    await this.redis.expire(key, 86400);
  }
}
