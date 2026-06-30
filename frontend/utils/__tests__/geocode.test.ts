/**
 * utils/__tests__/geocode.test.ts
 *
 * Unit tests for the client-side geocoding utility.
 */
import { geocodeLocation, jitterCoords } from "@/utils/geocode";

// ── geocodeLocation ────────────────────────────────────────────────────────────

describe("geocodeLocation", () => {
  describe("exact matches", () => {
    it("resolves 'Brazil'", () => {
      const { lat, lng } = geocodeLocation("Brazil");
      expect(lat).toBeCloseTo(-14.235, 1);
      expect(lng).toBeCloseTo(-51.925, 1);
    });

    it("resolves 'Kenya'", () => {
      const { lat, lng } = geocodeLocation("Kenya");
      expect(lat).toBeCloseTo(-0.02, 1);
      expect(lng).toBeCloseTo(37.9, 1);
    });

    it("resolves 'Australia'", () => {
      const { lat, lng } = geocodeLocation("Australia");
      expect(lat).toBeCloseTo(-25.274, 1);
      expect(lng).toBeCloseTo(133.775, 1);
    });

    it("resolves 'India'", () => {
      const { lat, lng } = geocodeLocation("India");
      expect(lat).toBeCloseTo(20.594, 1);
    });

    it("resolves 'Indonesia'", () => {
      const { lat, lng } = geocodeLocation("Indonesia");
      expect(lat).toBeCloseTo(-0.789, 1);
    });

    it("is case-insensitive", () => {
      expect(geocodeLocation("BRAZIL")).toEqual(geocodeLocation("brazil"));
      expect(geocodeLocation("Kenya")).toEqual(geocodeLocation("KENYA"));
    });

    it("trims surrounding whitespace", () => {
      expect(geocodeLocation("  Brazil  ")).toEqual(geocodeLocation("Brazil"));
    });
  });

  describe("keyword fallback matching", () => {
    it("resolves a string containing 'amazon' keyword", () => {
      const { lat, lng } = geocodeLocation("Amazon Basin, Peru");
      expect(lat).toBeCloseTo(-3.465, 1);
      expect(lng).toBeCloseTo(-62.215, 1);
    });

    it("resolves a string containing 'africa' keyword", () => {
      const coords = geocodeLocation("East Africa region");
      expect(coords.lat).toBeCloseTo(-8.8, 0);
    });

    it("resolves a string containing 'southeast asia' keyword", () => {
      const coords = geocodeLocation("Southeast Asia coastal areas");
      expect(coords.lat).toBeCloseTo(5.0, 0);
    });

    it("resolves a string containing 'pacific' keyword", () => {
      const coords = geocodeLocation("Pacific Island nations");
      expect(coords.lat).toBeCloseTo(-15.0, 0);
    });
  });

  describe("fallback for unknown locations", () => {
    it("returns {lat:0, lng:0} for completely unknown location string", () => {
      const coords = geocodeLocation("XYZ Unknown Place 99999");
      expect(coords.lat).toBe(0);
      expect(coords.lng).toBe(0);
    });

    it("returns a LatLng object for empty string", () => {
      const coords = geocodeLocation("");
      expect(coords).toHaveProperty("lat");
      expect(coords).toHaveProperty("lng");
    });
  });

  describe("known project categories (smoke tests)", () => {
    const KNOWN_LOCATIONS = [
      "Kenya",
      "Brazil",
      "Indonesia",
      "Colombia",
      "India",
      "Uganda",
      "Philippines",
      "Ethiopia",
      "Costa Rica",
      "Australia",
    ];

    it.each(KNOWN_LOCATIONS)("resolves '%s' without throwing", (loc) => {
      expect(() => geocodeLocation(loc)).not.toThrow();
      const coords = geocodeLocation(loc);
      expect(typeof coords.lat).toBe("number");
      expect(typeof coords.lng).toBe("number");
      // Sanity-check: coordinates must be in valid WGS84 range
      expect(coords.lat).toBeGreaterThanOrEqual(-90);
      expect(coords.lat).toBeLessThanOrEqual(90);
      expect(coords.lng).toBeGreaterThanOrEqual(-180);
      expect(coords.lng).toBeLessThanOrEqual(180);
    });
  });
});

// ── jitterCoords ──────────────────────────────────────────────────────────────

describe("jitterCoords", () => {
  const base = { lat: 0, lng: 0 };

  it("returns a different position than the base", () => {
    // A non-trivial id will produce non-zero offsets
    const jittered = jitterCoords(base, "some-project-id");
    // May be equal only for a hash of 0,0 — extremely unlikely with a real id
    const isShifted = jittered.lat !== base.lat || jittered.lng !== base.lng;
    expect(isShifted).toBe(true);
  });

  it("is deterministic for the same id", () => {
    const a = jitterCoords(base, "project-abc-123");
    const b = jitterCoords(base, "project-abc-123");
    expect(a.lat).toBe(b.lat);
    expect(a.lng).toBe(b.lng);
  });

  it("produces different offsets for different ids", () => {
    const a = jitterCoords(base, "id-alpha");
    const b = jitterCoords(base, "id-beta");
    const same = a.lat === b.lat && a.lng === b.lng;
    expect(same).toBe(false);
  });

  it("keeps jitter within the default ±0.8° spread", () => {
    const spread = 0.8;
    const coords = { lat: 20, lng: 30 };
    const jittered = jitterCoords(coords, "test-id", spread);
    expect(Math.abs(jittered.lat - coords.lat)).toBeLessThanOrEqual(spread);
    expect(Math.abs(jittered.lng - coords.lng)).toBeLessThanOrEqual(spread);
  });

  it("respects a custom spread value", () => {
    const spread = 2.5;
    const jittered = jitterCoords(base, "test-id", spread);
    expect(Math.abs(jittered.lat)).toBeLessThanOrEqual(spread);
    expect(Math.abs(jittered.lng)).toBeLessThanOrEqual(spread);
  });
});
