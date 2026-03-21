import { loadWatchlist } from "./config/loader";
import type { PlatformAdapter } from "./platforms/types";
import type { AlertPayload, NormalizedEvent } from "./types";
import type { AlertStateStore } from "./alerts/state";
import type { ApiBudgetStore } from "./state/api-budget";
import { sendAlertEmail } from "./alerts/emailer";

const DAILY_API_LIMIT = 4500;
// Alert for presales opening within this window
const PRESALE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface MonitorResult {
  eventsChecked: number;
  alertsSent: number;
  apiCallsUsed: number;
  errors: string[];
}

export interface MonitorDeps {
  alertState: AlertStateStore;
  apiBudget: ApiBudgetStore;
  platforms: PlatformAdapter[];
}

export async function monitor(deps: MonitorDeps): Promise<MonitorResult> {
  const { alertState, apiBudget, platforms } = deps;
  const config = loadWatchlist();
  const result: MonitorResult = {
    eventsChecked: 0,
    alertsSent: 0,
    apiCallsUsed: 0,
    errors: [],
  };

  const usedToday = await apiBudget.getUsedToday();
  if (usedToday >= DAILY_API_LIMIT) {
    result.errors.push(
      `Daily API limit reached (${usedToday}/${DAILY_API_LIMIT})`
    );
    return result;
  }

  const cooldownSec = config.settings.alert_cooldown_hours * 3600;
  const alerts: AlertPayload[] = [];
  let apiCalls = 0;

  for (const platform of platforms) {
    // Process artist watches
    for (const artist of config.artists) {
      if (usedToday + apiCalls >= DAILY_API_LIMIT) break;
      try {
        const events = await platform.searchEventsByArtist(
          artist.name,
          config.settings.geo_filter
        );
        apiCalls += 2;

        const maxPrice = artist.max_price ?? config.settings.default_max_price;
        const matches = await checkAllAlertTypes(
          events,
          maxPrice,
          artist.name,
          cooldownSec,
          alertState
        );
        alerts.push(...matches);
        result.eventsChecked += events.length;
      } catch (err) {
        result.errors.push(`Artist "${artist.name}": ${err}`);
      }
    }

    // Process event watches
    for (const eventWatch of config.events) {
      if (usedToday + apiCalls >= DAILY_API_LIMIT) break;
      try {
        let events: NormalizedEvent[] = [];

        if (eventWatch.ticketmaster_event_id) {
          const event = await platform.getEventById(
            eventWatch.ticketmaster_event_id
          );
          if (event) events = [event];
          apiCalls += 1;
        } else if (eventWatch.ticketmaster_keyword) {
          events = await platform.searchEventsByKeyword(
            eventWatch.ticketmaster_keyword
          );
          apiCalls += 1;
        }

        const maxPrice =
          eventWatch.max_price ?? config.settings.default_max_price;
        const matches = await checkAllAlertTypes(
          events,
          maxPrice,
          eventWatch.name,
          cooldownSec,
          alertState
        );
        alerts.push(...matches);
        result.eventsChecked += events.length;
      } catch (err) {
        result.errors.push(`Event "${eventWatch.name}": ${err}`);
      }
    }
  }

  // Send alerts
  if (alerts.length > 0) {
    try {
      await sendAlertEmail(config.settings.email, alerts);
      // Mark all as alerted + update stored prices
      for (const alert of alerts) {
        if (alert.type === "price_below") {
          await alertState.markAlerted(
            alert.event.platformEventId,
            alert.maxPrice,
            cooldownSec
          );
        }
        if (alert.type === "presale_opening" && alert.presaleName) {
          await alertState.markPresaleAlerted(
            alert.event.platformEventId,
            alert.presaleName,
            cooldownSec
          );
        }
        if (alert.type === "price_drop" && alert.event.priceRange) {
          await alertState.markAlerted(
            alert.event.platformEventId,
            alert.maxPrice,
            cooldownSec
          );
        }
      }
      result.alertsSent = alerts.length;
    } catch (err) {
      result.errors.push(`Email send failed: ${err}`);
    }
  }

  await apiBudget.increment(apiCalls);
  result.apiCallsUsed = apiCalls;
  return result;
}

async function checkAllAlertTypes(
  events: NormalizedEvent[],
  maxPrice: number,
  watchName: string,
  cooldownSec: number,
  alertState: AlertStateStore
): Promise<AlertPayload[]> {
  const alerts: AlertPayload[] = [];

  for (const event of events) {
    // 1. Price below threshold (existing)
    if (
      event.status === "onsale" &&
      event.priceRange &&
      event.priceRange.min <= maxPrice
    ) {
      const alreadyAlerted = await alertState.hasAlerted(
        event.platformEventId,
        maxPrice
      );
      if (!alreadyAlerted) {
        alerts.push({
          type: "price_below",
          event,
          watchName,
          maxPrice,
        });
      }
    }

    // 2. Presale detection — alert for presales opening within 24h
    if (event.presales && event.presales.length > 0) {
      const now = Date.now();
      for (const presale of event.presales) {
        const presaleStart = new Date(presale.startDateTime).getTime();
        const timeUntil = presaleStart - now;

        // Alert if presale is upcoming (within lookahead) or just started (within last hour)
        if (timeUntil <= PRESALE_LOOKAHEAD_MS && timeUntil > -3600_000) {
          const alerted = await alertState.hasPresaleAlerted(
            event.platformEventId,
            presale.name
          );
          if (!alerted) {
            const timeLabel = formatTimeUntil(timeUntil);
            alerts.push({
              type: "presale_opening",
              event,
              watchName,
              maxPrice,
              detail: `${presale.name} — opens in ${timeLabel}`,
              presaleName: presale.name,
            });
          }
        }
      }
    }

    // 3. Price drop detection — compare against stored price
    if (event.priceRange) {
      const stored = await alertState.getStoredPrice(event.platformEventId);
      if (
        stored &&
        event.priceRange.min < stored.min &&
        event.priceRange.min <= maxPrice
      ) {
        const dropAlerted = await alertState.hasAlerted(
          event.platformEventId,
          maxPrice
        );
        // Only alert price drops if we haven't already sent a price_below alert
        if (!dropAlerted) {
          alerts.push({
            type: "price_drop",
            event,
            watchName,
            maxPrice,
            detail: `$${stored.min} → $${event.priceRange.min}`,
          });
        }
      }
      // Always update stored price
      await alertState.storePrice(
        event.platformEventId,
        event.priceRange.min,
        event.priceRange.max
      );
    }
  }

  return alerts;
}

function formatTimeUntil(ms: number): string {
  if (ms <= 0) return "NOW";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
