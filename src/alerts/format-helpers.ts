import type { PlatformPrice } from "../types";

export function platformLabel(platform: string): string {
  switch (platform) {
    case "ticketmaster":
      return "Ticketmaster";
    case "seatgeek":
      return "SeatGeek";
    case "stubhub":
      return "StubHub";
    case "vividseats":
      return "Vivid Seats";
    default:
      return platform;
  }
}

export function platformPriceLinks(prices: PlatformPrice[]): string {
  if (prices.length <= 1) return "";
  return prices
    .slice(1)
    .map(
      (p) =>
        `<a href="${p.url}" style="color: #2563eb; text-decoration: none;">${platformLabel(p.platform)} ($${p.min})</a>`
    )
    .join(" &middot; ");
}

export function formatDate(iso: string): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  });
}

export function formatTimeUntil(ms: number): string {
  if (ms <= 0) return "NOW";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
