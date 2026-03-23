import type { AlertPayload, NormalizedEvent } from "./types";
import type { AlertStatePort, AlertSender } from "./alerts/ports";
import type { ApiBudgetStore } from "./state/api-budget";
import { AlertEngine } from "./alerts/engine";
import { defaultRules } from "./alerts/rules";
import { systemClock } from "./alerts/ports";
import type { PriceStore } from "./prices";
import { discoverForMonitor } from "./discovery";
import { loadWatchlist } from "./config/loader";
import type { PlatformAdapter } from "./platforms/types";

export interface MonitorResult {
  eventsChecked: number;
  alertsSent: number;
  apiCallsUsed: number;
  errors: string[];
}

export interface TicketMonitor {
  run(): Promise<MonitorResult>;
}

export interface MonitorDeps {
  alertState: AlertStatePort;
  apiBudget: ApiBudgetStore;
  platforms: PlatformAdapter[];
  sender: AlertSender;
  priceStore?: PriceStore;
}

export function createMonitor(deps: MonitorDeps): TicketMonitor {
  return {
    async run(): Promise<MonitorResult> {
      const { alertState, apiBudget, platforms, sender } = deps;
      const config = loadWatchlist();
      const engine = new AlertEngine(alertState, sender, defaultRules, systemClock);
      const result: MonitorResult = {
        eventsChecked: 0,
        alertsSent: 0,
        apiCallsUsed: 0,
        errors: [],
      };

      const cooldownSec = config.settings.alert_cooldown_hours * 3600;

      // Discover events from all platforms/watches
      // Budget read+write is handled internally by discoverForMonitor
      const discovery = await discoverForMonitor({
        platforms,
        apiBudget,
        config,
      });

      result.errors.push(...discovery.errors);
      result.apiCallsUsed = discovery.apiCallsUsed;

      // If budget was exhausted before any calls, bail early
      if (discovery.watchHits.length === 0 && discovery.errors.length > 0) {
        return result;
      }

      try {
        // Collect all unique events across watch hits for a single enrichment call
        const allWatchEvents = new Map<string, NormalizedEvent>();
        for (const hit of discovery.watchHits) {
          for (const e of hit.events) allWatchEvents.set(e.platformEventId, e);
        }
        const enrichedAll = deps.priceStore
          ? await deps.priceStore.enrich(Array.from(allWatchEvents.values()))
          : Array.from(allWatchEvents.values());
        const enrichedMap = new Map<string, NormalizedEvent>();
        for (const e of enrichedAll) enrichedMap.set(e.platformEventId, e);

        // Process each watch hit through AlertEngine
        const alerts: AlertPayload[] = [];
        for (const hit of discovery.watchHits) {
          const events = hit.events.map(
            (e) => enrichedMap.get(e.platformEventId) ?? e
          );

          const detected = await engine.detect(events, {
            watchName: hit.watchName,
            maxPrice: hit.maxPrice,
          });
          alerts.push(...detected);
          result.eventsChecked += events.length;
        }

        // Send alerts and mark state
        if (alerts.length > 0) {
          const flushResult = await engine.flush(
            alerts,
            config.settings.email,
            cooldownSec
          );
          result.alertsSent = flushResult.sent;
          result.errors.push(...flushResult.errors);
        }
      } catch (err) {
        result.errors.push(`Post-discovery failure: ${err}`);
      }

      return result;
    },
  };
}

/** Backward-compat wrapper — prefer `createMonitor(deps).run()` for new code. */
export async function monitor(deps: MonitorDeps): Promise<MonitorResult> {
  return createMonitor(deps).run();
}
