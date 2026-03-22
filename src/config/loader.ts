import type { WatchlistConfig, GeoFilter } from "./schema";
import watchlist from "./watchlist";

export function loadWatchlist(): WatchlistConfig {
  const geo: GeoFilter = {
    ...watchlist.settings.geo_filter,
    country_code: watchlist.settings.geo_filter?.country_code ?? "US",
  };

  // Geo from env vars (keeps coordinates out of source code)
  if (process.env.GEO_LAT && process.env.GEO_LON) {
    geo.lat = parseFloat(process.env.GEO_LAT);
    geo.lon = parseFloat(process.env.GEO_LON);
  }
  if (process.env.GEO_RANGE) {
    geo.range = process.env.GEO_RANGE;
  }

  return {
    ...watchlist,
    settings: {
      ...watchlist.settings,
      email: process.env.ALERT_EMAIL ?? watchlist.settings.email,
      geo_filter: geo,
    },
  };
}
