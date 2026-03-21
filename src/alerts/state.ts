import type { RedisClient } from "../state/redis";

const ALERT_PREFIX = "alert";
const PRESALE_PREFIX = "presale";
const PRICE_PREFIX = "price:v1";

function alertKey(eventId: string, threshold: number): string {
  return `${ALERT_PREFIX}:${eventId}:${threshold}`;
}

function presaleKey(eventId: string, presaleName: string): string {
  return `${PRESALE_PREFIX}:${eventId}:${presaleName.toLowerCase().replace(/\s+/g, "-")}`;
}

function priceKey(eventId: string): string {
  return `${PRICE_PREFIX}:${eventId}`;
}

export interface StoredPrice {
  min: number;
  max: number;
  timestamp: string;
}

export class AlertStateStore {
  constructor(private redis: RedisClient) {}

  // --- Alert dedup ---

  async hasAlerted(eventId: string, threshold: number): Promise<boolean> {
    const exists = await this.redis.exists(alertKey(eventId, threshold));
    return exists === 1;
  }

  /** @param ttlSec cooldown in seconds */
  async markAlerted(
    eventId: string,
    threshold: number,
    ttlSec: number
  ): Promise<void> {
    await this.redis.set(alertKey(eventId, threshold), "1", { ex: ttlSec });
  }

  // --- Presale dedup ---

  async hasPresaleAlerted(
    eventId: string,
    presaleName: string
  ): Promise<boolean> {
    const exists = await this.redis.exists(presaleKey(eventId, presaleName));
    return exists === 1;
  }

  /** @param ttlSec cooldown in seconds */
  async markPresaleAlerted(
    eventId: string,
    presaleName: string,
    ttlSec: number
  ): Promise<void> {
    await this.redis.set(presaleKey(eventId, presaleName), "1", {
      ex: ttlSec,
    });
  }

  // --- Price tracking ---

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
