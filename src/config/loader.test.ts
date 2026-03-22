import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadWatchlist } from "./loader";

describe("loadWatchlist", () => {
  const origEnv: Record<string, string | undefined> = {};
  const envKeys = ["ALERT_EMAIL", "GEO_LAT", "GEO_LON", "GEO_RANGE"];

  beforeEach(() => {
    for (const k of envKeys) {
      origEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (origEnv[k] !== undefined) process.env[k] = origEnv[k];
      else delete process.env[k];
    }
  });

  test("returns config with defaults when no env vars set", () => {
    const config = loadWatchlist();
    expect(config.settings.email).toBe("you@example.com");
    expect(config.settings.geo_filter?.lat).toBeUndefined();
    expect(config.settings.geo_filter?.lon).toBeUndefined();
  });

  test("ALERT_EMAIL overrides default email", () => {
    process.env.ALERT_EMAIL = "test@test.com";
    const config = loadWatchlist();
    expect(config.settings.email).toBe("test@test.com");
  });

  test("GEO_LAT + GEO_LON set geo coordinates", () => {
    process.env.GEO_LAT = "34.05";
    process.env.GEO_LON = "-118.24";
    const config = loadWatchlist();
    expect(config.settings.geo_filter?.lat).toBe(34.05);
    expect(config.settings.geo_filter?.lon).toBe(-118.24);
  });

  test("GEO_RANGE overrides range", () => {
    process.env.GEO_RANGE = "60mi";
    const config = loadWatchlist();
    expect(config.settings.geo_filter?.range).toBe("60mi");
  });

  test("invalid GEO_LAT is ignored (NaN guard)", () => {
    process.env.GEO_LAT = "not-a-number";
    process.env.GEO_LON = "-118.24";
    const config = loadWatchlist();
    expect(config.settings.geo_filter?.lat).toBeUndefined();
    expect(config.settings.geo_filter?.lon).toBeUndefined();
  });

  test("does not mutate the watchlist module singleton", () => {
    process.env.ALERT_EMAIL = "first@test.com";
    const config1 = loadWatchlist();
    delete process.env.ALERT_EMAIL;
    const config2 = loadWatchlist();
    expect(config1.settings.email).toBe("first@test.com");
    expect(config2.settings.email).toBe("you@example.com");
  });
});
