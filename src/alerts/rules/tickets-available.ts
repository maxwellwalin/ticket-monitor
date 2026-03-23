import type { NormalizedEvent } from "../../types";
import type { AlertStatePort, Clock } from "../ports";
import type { AlertCheckContext } from "../ports";
import type { AlertRule, RuleMatch } from "../rule";
import { platformLabel } from "../format-helpers";

export const ticketsAvailableRule: AlertRule = {
  type: "tickets_available",
  label: "Tickets Found",
  color: "#0891b2",
  priority: 100,
  dedupNamespace: "alert",
  suppresses: ["price_below", "price_drop"],

  async evaluate(
    event: NormalizedEvent,
    ctx: AlertCheckContext,
    _state: AlertStatePort,
    _clock: Clock
  ): Promise<RuleMatch[]> {
    if (
      event.priceRange?.source === "scraped" &&
      event.priceRange.min <= ctx.maxPrice
    ) {
      return [
        {
          detail: `$${event.priceRange.min} - $${event.priceRange.max} (resale/new)`,
        },
      ];
    }
    return [];
  },

  renderDetail(alert): string {
    const { event, detail } = alert;
    const pp = event.platformPrices;
    const ticketText =
      pp.length > 0
        ? `Best: $${pp[0].min} on ${platformLabel(pp[0].platform)}`
        : detail || "Tickets available";
    return `
        <div style="margin-bottom: 8px;">
          <span style="color: #0891b2; font-weight: bold;">Tickets found: ${ticketText}</span>
          <span style="color: #888; font-size: 13px;"> (your max: $${alert.maxPrice})</span>
        </div>`;
  },

  subjectFragment(count: number): string {
    return `${count} tickets found`;
  },
};
