/**
 * Run the alert engine against current prices in Redis.
 *
 * Discovers events, enriches with cached scraped prices, runs dedup +
 * alert rules, and sends email if any alerts fire.
 *
 * Usage: bun run monitor [--dry-run]
 */

import { createRedis } from "../src/state/redis";
import { createPriceStore } from "../src/prices";
import { createMonitor } from "../src/monitor";
import { ApiBudgetStore } from "../src/state/api-budget";
import { RedisAlertState } from "../src/alerts/adapters/redis-state";
import { createResendSender } from "../src/alerts/resend-sender";
import { buildAlertEmail } from "../src/alerts/templates";
import type { AlertSender } from "../src/alerts/ports";
import type { AlertPayload } from "../src/types";
import { createPlatforms } from "./utils";

const dryRun = process.argv.includes("--dry-run");

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
  const start = Date.now();
  console.log(`=== Monitor${dryRun ? " (dry run)" : ""} (${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}) ===\n`);

  const redis = createRedis();
  const platforms = createPlatforms();
  const sender = dryRun ? createDryRunSender() : createResendSender();

  const mon = createMonitor({
    alertState: new RedisAlertState(redis),
    apiBudget: new ApiBudgetStore(redis),
    platforms,
    sender,
    priceStore: createPriceStore(redis),
  });

  const result = await mon.run();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`=== Done (${elapsed}s) ===`);
  console.log(`  Events checked: ${result.eventsChecked}`);
  console.log(`  Alerts sent: ${result.alertsSent}`);
  console.log(`  API calls: ${result.apiCallsUsed}`);
  if (result.errors.length > 0) {
    for (const err of result.errors) console.log(`  Error: ${err}`);
  }
}

main().catch(console.error);
