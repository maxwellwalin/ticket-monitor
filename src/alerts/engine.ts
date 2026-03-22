import type { AlertPayload, NormalizedEvent } from "../types";
import type { AlertStatePort, AlertSender, AlertCheckContext, Clock } from "./ports";
import type { AlertRule } from "./rule";

// Re-export for callers that imported from engine
export type { AlertSender, AlertCheckContext } from "./ports";

export interface SendResult {
  sent: number;
  markedInState: number;
  errors: string[];
}

export class AlertEngine {
  constructor(
    private state: AlertStatePort,
    private sender: AlertSender,
    private rules: AlertRule[],
    private clock: Clock
  ) {}

  /**
   * Detect alerts for a batch of events using the rule-based system.
   * READ-ONLY against store — does NOT call storePrice().
   */
  async detect(
    events: NormalizedEvent[],
    ctx: AlertCheckContext
  ): Promise<AlertPayload[]> {
    const alerts: AlertPayload[] = [];

    for (const event of events) {
      const skipTypes = new Set<string>();

      for (const rule of this.rules) {
        if (skipTypes.has(rule.type)) continue;

        const matches = await rule.evaluate(event, ctx, this.state, this.clock);

        for (const match of matches) {
          const key = rule.dedupKey(event, match, ctx);
          if (await this.state.hasAlerted(key)) continue;

          alerts.push({
            type: rule.type as AlertPayload["type"],
            event,
            watchName: ctx.watchName,
            maxPrice: ctx.maxPrice,
            detail: match.detail,
            dedupKey: key,
          });

          if (rule.skipTypes) {
            for (const t of rule.skipTypes) skipTypes.add(t);
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Update stored prices for all events with price data.
   * Called unconditionally after detection to maintain price history baseline.
   */
  async updatePrices(events: NormalizedEvent[]): Promise<void> {
    for (const event of events) {
      if (event.priceRange) {
        await this.state.storePrice(
          event.platformEventId,
          event.priceRange.min,
          event.priceRange.max
        );
      }
    }
  }

  /**
   * Mark alerts in state, then send email.
   * Mark-before-send: if email fails, alerts are already marked to prevent spam.
   */
  async sendAndMark(
    alerts: AlertPayload[],
    email: string,
    cooldownSec: number
  ): Promise<SendResult> {
    const result: SendResult = { sent: 0, markedInState: 0, errors: [] };
    if (alerts.length === 0) return result;

    // 1. Mark all alerts in Redis first (prevents spam if email fails)
    for (const alert of alerts) {
      await this.state.markAlerted(alert.dedupKey, cooldownSec);
      result.markedInState++;
    }

    // 2. Send email
    try {
      await this.sender.send(email, alerts);
      result.sent = alerts.length;
    } catch (err) {
      result.errors.push(`Email send failed: ${err}`);
    }

    return result;
  }
}
