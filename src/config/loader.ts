import type { WatchlistConfig } from "./schema";
import watchlist from "./watchlist";

export function loadWatchlist(): WatchlistConfig {
  const config = { ...watchlist, settings: { ...watchlist.settings } };
  if (process.env.ALERT_EMAIL) {
    config.settings.email = process.env.ALERT_EMAIL;
  }
  return config;
}
