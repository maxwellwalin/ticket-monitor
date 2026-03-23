import type { NormalizedEvent } from "../../types";
import type { AlertStatePort, Clock } from "../ports";
import type { AlertCheckContext } from "../ports";
import type { AlertRule, RuleMatch } from "../rule";
import { platformLabel } from "../format-helpers";

export const priceBelowRule: AlertRule = {
  type: "price_below",
  label: "Price Match",
  color: "#16a34a",
  priority: 80,
  dedupNamespace: "alert",
  suppresses: ["price_drop"],

  async evaluate(
    event: NormalizedEvent,
    ctx: AlertCheckContext,
    _state: AlertStatePort,
    _clock: Clock
  ): Promise<RuleMatch[]> {
    // API-sourced prices only (no "scraped" source — that's tickets_available)
    if (
      event.status === "onsale" &&
      event.priceRange &&
      event.priceRange.source !== "scraped" &&
      event.priceRange.min <= ctx.maxPrice
    ) {
      const pp = event.platformPrices;
      const priceText =
        pp.length > 0
          ? `Best: $${pp[0].min} on ${platformLabel(pp[0].platform)}`
          : `$${event.priceRange.min} - $${event.priceRange.max} ${event.priceRange.currency}`;
      return [{ detail: priceText }];
    }
    return [];
  },

  renderDetail(alert): string {
    const { event, maxPrice, detail } = alert;
    const pp = event.platformPrices;
    const priceText =
      pp.length > 0
        ? `Best: $${pp[0].min} on ${platformLabel(pp[0].platform)}`
        : detail || (event.priceRange
          ? `$${event.priceRange.min} - $${event.priceRange.max} ${event.priceRange.currency}`
          : "Price TBD");
    return `
        <div style="margin-bottom: 8px;">
          <span style="color: #16a34a; font-weight: bold;">${priceText}</span>
          <span style="color: #888; font-size: 13px;"> (your max: $${maxPrice})</span>
        </div>`;
  },

  subjectFragment(count: number): string {
    return `${count} price match${count > 1 ? "es" : ""}`;
  },
};
