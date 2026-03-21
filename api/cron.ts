import { monitor } from "../src/monitor";
import { createRedis } from "../src/state/redis";
import { ApiBudgetStore } from "../src/state/api-budget";
import { AlertStateStore } from "../src/alerts/state";
import { AttractionCache } from "../src/platforms/ticketmaster/cache";
import { TicketmasterAdapter } from "../src/platforms/index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const redis = createRedis();
    const alertState = new AlertStateStore(redis);
    const apiBudget = new ApiBudgetStore(redis);
    const cache = new AttractionCache(redis);
    const platforms = [new TicketmasterAdapter(cache)];

    const result = await monitor({ alertState, apiBudget, platforms });
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
