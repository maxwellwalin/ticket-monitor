import type { AlertPayload } from "../types";
import type { AlertRule } from "./rule";
import { defaultRules } from "./rules";
import { formatDate, platformLabel, platformPriceLinks } from "./format-helpers";

// Re-export for any external callers
export { platformLabel } from "./format-helpers";

/** Map rule.type -> rule for fast lookup */
const rulesByType = new Map<string, AlertRule>();
for (const r of defaultRules) rulesByType.set(r.type, r);

function alertBadge(rule: AlertRule): string {
  return `<span style="display: inline-block; padding: 2px 8px; background: ${rule.color}; color: white; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase;">${rule.label}</span>`;
}

function detailLine(alert: AlertPayload): string {
  const rule = rulesByType.get(alert.type);
  if (rule) {
    return rule.renderDetail({
      event: alert.event,
      maxPrice: alert.maxPrice,
      detail: alert.detail,
    });
  }
  return "";
}

function alertRow(alert: AlertPayload): string {
  const { event, watchName } = alert;
  const rule = rulesByType.get(alert.type);
  const pp = event.platformPrices;
  const buyUrl = pp.length > 0 ? pp[0].url : event.url;
  const alsoOnHtml = platformPriceLinks(pp);

  return `
    <tr>
      <td style="padding: 16px; border-bottom: 1px solid #eee;">
        <div style="margin-bottom: 6px;">
          ${rule ? alertBadge(rule) : ""}
        </div>
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 4px;">
          ${event.name}
        </div>
        <div style="color: #666; font-size: 14px; margin-bottom: 4px;">
          ${formatDate(event.date)} &middot; ${event.venueName}, ${event.venueCity}
        </div>
        ${detailLine(alert)}
        <div style="font-size: 13px; color: #888; margin-bottom: 8px;">
          Watching: ${watchName}
        </div>
        <a href="${buyUrl}" style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Buy Tickets
        </a>
        ${alsoOnHtml ? `<div style="font-size: 13px; color: #666; margin-top: 8px;">Also on: ${alsoOnHtml}</div>` : ""}
      </td>
    </tr>`;
}

function buildSubject(alerts: AlertPayload[]): string {
  // Count alerts per rule type and build fragments
  const counts = new Map<string, number>();
  for (const a of alerts) {
    counts.set(a.type, (counts.get(a.type) || 0) + 1);
  }

  const parts: string[] = [];
  // Use rule evaluation order for consistent subject line ordering
  for (const rule of defaultRules) {
    const count = counts.get(rule.type);
    if (count) parts.push(rule.subjectFragment(count));
  }

  return `Ticket Alert: ${parts.join(", ")}`;
}

export function buildAlertEmail(alerts: AlertPayload[]): {
  subject: string;
  html: string;
} {
  const subject = buildSubject(alerts);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="margin-bottom: 4px;">Ticket Alert</h2>
  <p style="color: #666; margin-top: 0;">${alerts.length} alert${alerts.length > 1 ? "s" : ""} for your watchlist</p>
  <table style="width: 100%; border-collapse: collapse;">
    ${alerts.map(alertRow).join("")}
  </table>
  <p style="color: #999; font-size: 12px; margin-top: 24px;">
    Sent by Ticket Monitor. Prices shown are from Ticketmaster, SeatGeek, StubHub, and Vivid Seats and may not reflect individual seat prices.
  </p>
</body>
</html>`;

  return { subject, html };
}
