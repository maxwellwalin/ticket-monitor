import type { AlertPayload, AlertType } from "../types";

function formatDate(iso: string): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const TYPE_LABELS: Record<AlertType, { label: string; color: string }> = {
  price_below: { label: "Price Match", color: "#16a34a" },
  presale_opening: { label: "Presale", color: "#9333ea" },
  price_drop: { label: "Price Drop", color: "#ea580c" },
};

function alertBadge(type: AlertType): string {
  const { label, color } = TYPE_LABELS[type];
  return `<span style="display: inline-block; padding: 2px 8px; background: ${color}; color: white; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase;">${label}</span>`;
}

function detailLine(alert: AlertPayload): string {
  const { type, event, maxPrice, detail } = alert;
  const price = event.priceRange;

  switch (type) {
    case "price_below": {
      const priceText = price
        ? `$${price.min} - $${price.max} ${price.currency}`
        : "Price TBD";
      return `
        <div style="margin-bottom: 8px;">
          <span style="color: #16a34a; font-weight: bold;">${priceText}</span>
          <span style="color: #888; font-size: 13px;"> (your max: $${maxPrice})</span>
        </div>`;
    }
    case "presale_opening": {
      return `
        <div style="margin-bottom: 8px;">
          <span style="color: #9333ea; font-weight: bold;">${detail || "Presale"}</span>
          <span style="color: #888; font-size: 13px;"> — opens soon, get ready!</span>
        </div>`;
    }
    case "price_drop": {
      return `
        <div style="margin-bottom: 8px;">
          <span style="color: #ea580c; font-weight: bold;">Price dropped: ${detail}</span>
          <span style="color: #888; font-size: 13px;"> (your max: $${maxPrice})</span>
        </div>`;
    }
  }
}

function alertRow(alert: AlertPayload): string {
  const { event, watchName, type } = alert;

  return `
    <tr>
      <td style="padding: 16px; border-bottom: 1px solid #eee;">
        <div style="margin-bottom: 6px;">
          ${alertBadge(type)}
        </div>
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 4px;">
          ${event.name}
        </div>
        <div style="color: #666; font-size: 14px; margin-bottom: 4px;">
          ${formatDate(event.date)} &middot; ${event.venueName}, ${event.venueCity}
        </div>
        ${detailLine(alert)}
        <div style="font-size: 13px; color: #888; margin-bottom: 8px;">
          Watching: ${watchName} &middot; Status: ${event.status}
        </div>
        <a href="${event.url}" style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Buy Tickets
        </a>
      </td>
    </tr>`;
}

function buildSubject(alerts: AlertPayload[]): string {
  const types = new Set(alerts.map((a) => a.type));
  const parts: string[] = [];
  if (types.has("presale_opening"))
    parts.push(`${alerts.filter((a) => a.type === "presale_opening").length} presale`);
  if (types.has("price_drop"))
    parts.push(`${alerts.filter((a) => a.type === "price_drop").length} price drop`);
  if (types.has("price_below"))
    parts.push(`${alerts.filter((a) => a.type === "price_below").length} price match`);
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
    Sent by Ticket Monitor. Prices shown are from Ticketmaster's listed range and may not reflect individual seat prices.
  </p>
</body>
</html>`;

  return { subject, html };
}
