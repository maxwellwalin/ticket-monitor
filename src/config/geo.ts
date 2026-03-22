import type { GeoFilter } from "./schema";

export type ResolvedGeo =
  | { kind: "latlong"; lat: number; lon: number; radiusMi: number }
  | { kind: "state"; stateCode: string; countryCode: string }
  | { kind: "none" };

const DMA_CENTERS: Record<
  string,
  { lat: number; lon: number; defaultRadiusMi: number }
> = {
  "324": { lat: 34.0522, lon: -118.2437, defaultRadiusMi: 60 },
};

/** Parse a range string like "120mi" into miles. Returns undefined on bad input. */
function parseRangeMi(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const match = range.match(/^(\d+)(mi|km)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2] === "km" ? Math.round(value * 0.621371) : value;
}

/**
 * Single source of truth for resolving raw GeoFilter config into a
 * normalized geo representation that platform adapters can consume.
 *
 * Priority: explicit lat/lon > DMA lookup > state fallback > none
 */
export function resolveGeo(raw?: GeoFilter): ResolvedGeo {
  if (!raw) return { kind: "none" };

  // Explicit lat/lon wins
  if (raw.lat != null && raw.lon != null) {
    const radiusMi = parseRangeMi(raw.range) ?? 60;
    return { kind: "latlong", lat: raw.lat, lon: raw.lon, radiusMi };
  }

  // DMA lookup resolves to latlong coords
  if (raw.dma_id) {
    const center = DMA_CENTERS[raw.dma_id];
    if (center) {
      const radiusMi = parseRangeMi(raw.range) ?? center.defaultRadiusMi;
      return {
        kind: "latlong",
        lat: center.lat,
        lon: center.lon,
        radiusMi,
      };
    }
  }

  // State fallback
  if (raw.state_code) {
    return {
      kind: "state",
      stateCode: raw.state_code,
      countryCode: raw.country_code ?? "US",
    };
  }

  return { kind: "none" };
}
