import { createMonitor } from "../src/monitor";
import { createRedis } from "../src/state/redis";
import { ApiBudgetStore } from "../src/state/api-budget";
import { RedisAlertState } from "../src/alerts/adapters/redis-state";
import { AttractionCache } from "../src/platforms/ticketmaster/cache";
import { createPriceStore } from "../src/prices";
import { TicketmasterClient } from "../src/platforms/index";
import { SeatGeekClient } from "../src/platforms/seatgeek/index";
import { createResendSender } from "../src/alerts/resend-sender";
import { createRateLimiter } from "../src/platforms/rate-limiter";
import type { PlatformAdapter } from "../src/platforms/types";

export const config = { maxDuration: 60 };

export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const redis = createRedis();
    const alertState = new RedisAlertState(redis);
    const apiBudget = new ApiBudgetStore(redis);
    const tmCache = new AttractionCache(redis, "tm");
    const priceStore = createPriceStore(redis);

    const tmRateLimiter = createRateLimiter(500);
    const sgRateLimiter = createRateLimiter(200);

    const platforms: PlatformAdapter[] = [
      new TicketmasterClient({ cache: tmCache, rateLimiter: tmRateLimiter }),
    ];
    if (process.env.SEATGEEK_CLIENT_ID) {
      const sgCache = new AttractionCache(redis, "sg");
      platforms.push(new SeatGeekClient({ rateLimiter: sgRateLimiter, performerCache: sgCache }));
    }
    const sender = createResendSender();

    const mon = createMonitor({ alertState, apiBudget, platforms, sender, priceStore });
    const result = await mon.run();
    console.log("Monitor result:", JSON.stringify(result));
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("Monitor failed:", err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
