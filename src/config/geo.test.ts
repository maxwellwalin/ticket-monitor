import { describe, test, expect } from "bun:test";
import { resolveGeo } from "./geo";

describe("resolveGeo", () => {
  test("undefined → none", () => {
    expect(resolveGeo()).toEqual({ kind: "none" });
  });

  test("empty object → none", () => {
    expect(resolveGeo({ country_code: "US" })).toEqual({ kind: "none" });
  });

  test("explicit lat/lon with range", () => {
    expect(
      resolveGeo({ lat: 34.05, lon: -118.24, range: "120mi", country_code: "US" })
    ).toEqual({ kind: "latlong", lat: 34.05, lon: -118.24, radiusMi: 120 });
  });

  test("explicit lat/lon without range defaults to 60mi", () => {
    expect(
      resolveGeo({ lat: 34.05, lon: -118.24, country_code: "US" })
    ).toEqual({ kind: "latlong", lat: 34.05, lon: -118.24, radiusMi: 60 });
  });

  test("lat without lon → falls through", () => {
    expect(resolveGeo({ lat: 34.05, country_code: "US" })).toEqual({
      kind: "none",
    });
  });

  test("km range converted to miles", () => {
    const result = resolveGeo({ lat: 34.05, lon: -118.24, range: "100km", country_code: "US" });
    expect(result).toEqual({ kind: "latlong", lat: 34.05, lon: -118.24, radiusMi: 62 });
  });

  test("DMA 324 resolves to LA", () => {
    expect(resolveGeo({ dma_id: "324", country_code: "US" })).toEqual({
      kind: "latlong",
      lat: 34.0522,
      lon: -118.2437,
      radiusMi: 60,
    });
  });

  test("DMA 324 with custom range", () => {
    expect(resolveGeo({ dma_id: "324", range: "100mi", country_code: "US" })).toEqual({
      kind: "latlong",
      lat: 34.0522,
      lon: -118.2437,
      radiusMi: 100,
    });
  });

  test("unknown DMA falls through to state", () => {
    expect(
      resolveGeo({ dma_id: "999", state_code: "CA", country_code: "US" })
    ).toEqual({ kind: "state", stateCode: "CA", countryCode: "US" });
  });

  test("state_code without country defaults to US", () => {
    expect(resolveGeo({ state_code: "NY", country_code: "US" })).toEqual({
      kind: "state",
      stateCode: "NY",
      countryCode: "US",
    });
  });

  test("lat/lon takes priority over DMA", () => {
    const result = resolveGeo({
      lat: 40.7,
      lon: -74.0,
      dma_id: "324",
      range: "50mi",
      country_code: "US",
    });
    expect(result).toEqual({ kind: "latlong", lat: 40.7, lon: -74.0, radiusMi: 50 });
  });

  test("invalid range format ignored, defaults to 60", () => {
    expect(
      resolveGeo({ lat: 34.05, lon: -118.24, range: "far", country_code: "US" })
    ).toEqual({ kind: "latlong", lat: 34.05, lon: -118.24, radiusMi: 60 });
  });
});
