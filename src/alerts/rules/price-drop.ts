import type { NormalizedEvent } from "../../types";
import type { AlertStatePort, Clock } from "../ports";
import type { AlertCheckContext } from "../ports";
import type { AlertRule, RuleMatch } from "../rule";

export const priceDropRule: AlertRule = {
  type: "price_drop",
  label: "Price Drop",
  color: "#ea580c",

  async evaluate(
    event: NormalizedEvent,
    ctx: AlertCheckContext,
    state: AlertStatePort,
    _clock: Clock
  ): Promise<RuleMatch[]> {
    if (!event.priceRange) return [];

    const stored = await state.getStoredPrice(event.platformEventId);
    if (
      stored &&
      event.priceRange.min < stored.min &&
      event.priceRange.min <= ctx.maxPrice
    ) {
      return [
        { detail: `$${stored.min} → $${event.priceRange.min}` },
      ];
    }
    return [];
  },

  dedupKey(event: NormalizedEvent, _match: RuleMatch, ctx: AlertCheckContext): string {
    return `alert:${event.platformEventId}:${ctx.maxPrice}`;
  },

  renderDetail(alert): string {
    return `
        <div style="margin-bottom: 8px;">
          <span style="color: #ea580c; font-weight: bold;">Price dropped: ${alert.detail}</span>
          <span style="color: #888; font-size: 13px;"> (your max: $${alert.maxPrice})</span>
        </div>`;
  },

  subjectFragment(count: number): string {
    return `${count} price drop${count > 1 ? "s" : ""}`;
  },
};
