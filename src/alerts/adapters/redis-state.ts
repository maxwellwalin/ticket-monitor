import type { RedisClient } from "../../state/redis";
import type { AlertStatePort, StoredPrice } from "../ports";

const PRICE_PREFIX = "price:v1";

function priceKey(eventId: string): string {
  return `${PRICE_PREFIX}:${eventId}`;
}

export class RedisAlertState implements AlertStatePort {
  constructor(private redis: RedisClient) {}

  async hasAlerted(dedupKey: string): Promise<boolean> {
    const exists = await this.redis.exists(dedupKey);
    return exists === 1;
  }

  async markAlerted(dedupKey: string, ttlSec: number): Promise<void> {
    await this.redis.set(dedupKey, "1", { ex: ttlSec });
  }

  async getStoredPrice(eventId: string): Promise<StoredPrice | null> {
    return this.redis.get<StoredPrice>(priceKey(eventId));
  }

  async storePrice(
    eventId: string,
    min: number,
    max: number
  ): Promise<void> {
    const data: StoredPrice = {
      min,
      max,
      timestamp: new Date().toISOString(),
    };
    await this.redis.set(priceKey(eventId), data, { ex: 86400 * 30 });
  }
}
