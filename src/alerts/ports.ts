import type { AlertPayload } from "../types";

export interface StoredPrice {
  min: number;
  max: number;
  timestamp: string;
}

export interface AlertStatePort {
  hasAlerted(dedupKey: string): Promise<boolean>;
  markAlerted(dedupKey: string, ttlSec: number): Promise<void>;
  getStoredPrice(eventId: string): Promise<StoredPrice | null>;
  storePrice(eventId: string, min: number, max: number): Promise<void>;
}

export interface AlertCheckContext {
  watchName: string;
  maxPrice: number;
}

export interface AlertSender {
  send(to: string, alerts: AlertPayload[]): Promise<void>;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
