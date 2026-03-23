/**
 * Local test — runs the full monitor pipeline (discovery + dedup + alert engine)
 * with a dry-run sender that logs alerts instead of emailing.
 *
 * Usage: bun run scripts/test-monitor.ts
 */

import { createMonitor } from "../src/monitor";
import { createRedis } from "../src/state/redis";
import { ApiBudgetStore } from "../src/state/api-budget";
import { RedisAlertState } from "../src/alerts/adapters/redis-state";
import { createPriceStore } from "../src/prices";
import { TicketmasterClient } from "../src/platforms/index";
import { SeatGeekClient } from "../src/platforms/seatgeek/index";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import { buildAlertEmail } from "../src/alerts/templates";
import type { AlertSender } from "../src/alerts/ports";
import type { AlertPayload } from "../src/types";
import type { PlatformAdapter } from "../src/platforms/types";
import { MemoryAttractionCache } from "./utils";

// Dry-run sender: prints alerts instead of emailing
function createDryRunSender(): AlertSender {
  return {
    async send(_to: string, alerts: AlertPayload[]): Promise<void> {
      console.log(`\n=== EMAIL WOULD BE SENT (${alerts.length} alerts) ===`);
      for (const alert of alerts) {
        const pp = alert.event.platformPrices;
        const bestPrice = pp.length > 0 ? `$${pp[0].min} on ${pp[0].platform}` : "N/A";
        console.log(`  [${alert.type}] ${alert.event.name}`);
        console.log(`    ${alert.event.venueName}, ${alert.event.venueCity} | ${alert.event.date.slice(0, 10)}`);
        console.log(`    Status: ${alert.event.status} | Best: ${bestPrice} | Max: $${alert.maxPrice}`);
        console.log(`    Watch: ${alert.watchName} | Dedup: ${alert.dedupKey}`);
        if (alert.detail) console.log(`    Detail: ${alert.detail}`);
      }
      const { subject } = buildAlertEmail(alerts);
      console.log(`  Subject: ${subject}`);
      console.log(`=== END ===\n`);
    },
  };
}

async function main() {
  const redis = createRedis();
  const alertState = new RedisAlertState(redis);
  const apiBudget = new ApiBudgetStore(redis);
  const priceStore = createPriceStore(redis);

  const platforms: PlatformAdapter[] = [
    new TicketmasterClient({
      cache: new MemoryAttractionCache(),
      rateLimiter: createRateLimiter(500),
    }),
  ];

  if (process.env.SEATGEEK_CLIENT_ID) {
    platforms.push(
      new SeatGeekClient({
        rateLimiter: createRateLimiter(200),
        performerCache: new MemoryAttractionCache(),
      })
    );
    console.log("SeatGeek: enabled");
  }

  const sender = createDryRunSender();
  const mon = createMonitor({ alertState, apiBudget, platforms, sender, priceStore });

  console.log("Running full monitor pipeline...\n");
  const result = await mon.run();

  console.log("--- Monitor Result ---");
  console.log(`  Events checked: ${result.eventsChecked}`);
  console.log(`  Alerts sent: ${result.alertsSent}`);
  console.log(`  API calls: ${result.apiCallsUsed}`);
  if (result.errors.length > 0) {
    console.log(`  Errors:`);
    for (const err of result.errors) console.log(`    - ${err}`);
  }
}

main().catch(console.error);
