import type { AlertPayload, NormalizedEvent } from "../types";
import type { AlertStatePort, AlertSender, AlertCheckContext, Clock } from "./ports";
import type { AlertRule, RuleMatch } from "./rule";

// Re-export for callers that imported from engine
export type { AlertSender, AlertCheckContext } from "./ports";

export interface FlushResult {
  sent: number;
  markedInState: number;
  errors: string[];
}

export class AlertEngine {
  private rules: AlertRule[];
  private priceUpdated = new Set<string>();

  constructor(
    private state: AlertStatePort,
    private sender: AlertSender,
    rules: AlertRule[],
    private clock: Clock
  ) {
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  private buildDedupKey(
    rule: AlertRule,
    event: NormalizedEvent,
    match: RuleMatch,
    ctx: AlertCheckContext
  ): string {
    const discriminator = rule.dedupDiscriminator
      ? rule.dedupDiscriminator(event, match, ctx)
      : String(ctx.maxPrice);
    return `${rule.dedupNamespace}:${event.platformEventId}:${discriminator}`;
  }

  /**
   * Detect alerts for a batch of events using the rule-based system.
   * Also stores prices after rule evaluation for each event.
   */
  async detect(
    events: NormalizedEvent[],
    ctx: AlertCheckContext
  ): Promise<AlertPayload[]> {
    const alerts: AlertPayload[] = [];

    for (const event of events) {
      const suppressedTypes = new Set<string>();

      for (const rule of this.rules) {
        if (suppressedTypes.has(rule.type)) continue;

        const matches = await rule.evaluate(event, ctx, this.state, this.clock);

        for (const match of matches) {
          const key = this.buildDedupKey(rule, event, match, ctx);
          if (await this.state.hasAlerted(key)) continue;

          alerts.push({
            type: rule.type as AlertPayload["type"],
            event,
            watchName: ctx.watchName,
            maxPrice: ctx.maxPrice,
            detail: match.detail,
            dedupKey: key,
          });

          if (rule.suppresses) {
            for (const t of rule.suppresses) suppressedTypes.add(t);
          }
        }
      }

      // Store price after all rules evaluated for this event
      if (event.priceRange && !this.priceUpdated.has(event.platformEventId)) {
        await this.state.storePrice(event.platformEventId, event.priceRange.min, event.priceRange.max);
        this.priceUpdated.add(event.platformEventId);
      }
    }

    return alerts;
  }

  /**
   * Send email FIRST, then mark dedup keys only after successful send.
   * If email fails, alerts will retry next cycle.
   */
  async flush(
    alerts: AlertPayload[],
    email: string,
    cooldownSec: number
  ): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, markedInState: 0, errors: [] };
    if (alerts.length === 0) return result;

    // 1. Send email FIRST
    try {
      await this.sender.send(email, alerts);
      result.sent = alerts.length;
    } catch (err) {
      result.errors.push(`Email send failed: ${err}`);
      return result; // Do NOT mark — alerts will retry next cycle
    }

    // 2. Mark dedup keys only after successful send
    for (const alert of alerts) {
      await this.state.markAlerted(alert.dedupKey, cooldownSec);
      result.markedInState++;
    }

    return result;
  }
}
