import type { NormalizedEvent } from "../../types";
import type { AlertStatePort, Clock } from "../ports";
import type { AlertCheckContext } from "../ports";
import type { AlertRule, RuleMatch } from "../rule";
import { formatTimeUntil } from "../format-helpers";

const PRESALE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000; // 24 hours

export const presaleOpeningRule: AlertRule = {
  type: "presale_opening",
  label: "Presale",
  color: "#9333ea",

  async evaluate(
    event: NormalizedEvent,
    _ctx: AlertCheckContext,
    _state: AlertStatePort,
    clock: Clock
  ): Promise<RuleMatch[]> {
    if (!event.presales || event.presales.length === 0) return [];

    const now = clock.now();
    const matches: RuleMatch[] = [];

    for (const presale of event.presales) {
      const presaleStart = new Date(presale.startDateTime).getTime();
      const timeUntil = presaleStart - now;

      // Alert if presale is upcoming (within lookahead) or just started (within last hour)
      if (timeUntil <= PRESALE_LOOKAHEAD_MS && timeUntil > -3600_000) {
        const timeLabel = formatTimeUntil(timeUntil);
        const verb = timeUntil <= 0 ? "LIVE NOW" : `opens in ${timeLabel}`;
        matches.push({
          detail: `${presale.name} — ${verb}`,
          meta: { presaleName: presale.name },
        });
      }
    }

    return matches;
  },

  dedupKey(event: NormalizedEvent, match: RuleMatch, _ctx: AlertCheckContext): string {
    const name = match.meta?.presaleName ?? "unknown";
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    return `presale:${event.platformEventId}:${slug}`;
  },

  renderDetail(alert): string {
    return `
        <div style="margin-bottom: 8px;">
          <span style="color: #9333ea; font-weight: bold;">${alert.detail || "Presale"}</span>
          <span style="color: #888; font-size: 13px;"> — opens soon, get ready!</span>
        </div>`;
  },

  subjectFragment(count: number): string {
    return `${count} presale${count > 1 ? "s" : ""}`;
  },
};
