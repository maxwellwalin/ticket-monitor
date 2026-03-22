export async function GET() {
  const errors: string[] = [];

  try {
    const { loadWatchlist } = await import("../src/config/loader");
    const config = loadWatchlist();
    errors.push(`config: ${config.artists.length} artists`);
  } catch (e) {
    errors.push(`config: ${e}`);
  }

  try {
    const { createRedis } = await import("../src/state/redis");
    const redis = createRedis();
    errors.push(`redis: ok`);
  } catch (e) {
    errors.push(`redis: ${e}`);
  }

  try {
    const { createResendSender } = await import("../src/alerts/resend-sender");
    createResendSender();
    errors.push(`resend: ok`);
  } catch (e) {
    errors.push(`resend: ${e}`);
  }

  try {
    const { monitor } = await import("../src/monitor");
    errors.push(`monitor: imported ok`);
  } catch (e) {
    errors.push(`monitor: ${e}`);
  }

  return Response.json({ checks: errors });
}
