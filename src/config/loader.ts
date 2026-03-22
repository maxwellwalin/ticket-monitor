import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { watchlistSchema, type WatchlistConfig } from "./schema";

export function loadWatchlist(): WatchlistConfig {
  // Try multiple resolution strategies:
  // 1. process.cwd() — works on both Vercel (function root) and local bun run
  // 2. import.meta.dir — Bun-specific fallback
  const candidates = [
    resolve(process.cwd(), "watchlist.yml"),
    ...(typeof import.meta.dir === "string"
      ? [resolve(import.meta.dir, "../../watchlist.yml")]
      : []),
  ];
  for (const path of candidates) {
    try {
      const text = readFileSync(path, "utf-8");
      const raw = parse(text);
      const config = watchlistSchema.parse(raw);
      // Allow ALERT_EMAIL env var to override watchlist email (keeps PII out of repo)
      if (process.env.ALERT_EMAIL) {
        config.settings.email = process.env.ALERT_EMAIL;
      }
      return config;
    } catch {
      continue;
    }
  }
  throw new Error(`watchlist.yml not found (tried: ${candidates.join(", ")})`);
}
