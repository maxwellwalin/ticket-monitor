import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { watchlistSchema, type WatchlistConfig } from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadWatchlist(): WatchlistConfig {
  const text = readFileSync(join(__dirname, "../../watchlist.yml"), "utf-8");
  const raw = parse(text);
  return watchlistSchema.parse(raw);
}
