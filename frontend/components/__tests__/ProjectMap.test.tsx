import { computeBufferedBbox } from "../ProjectMap";

describe("computeBufferedBbox", () => {
  it("computes bbox with 20% buffer on all sides", () => {
    const mockBounds = {
      getSouth: () => 10,
      getNorth: () => 20,
      getWest: () => 30,
      getEast: () => 40,
    } as any;

    // lat span = 10, buffer = 2 -> minLat = 8, maxLat = 22
    // lng span = 10, buffer = 2 -> minLng = 28, maxLng = 42
    const bbox = computeBufferedBbox(mockBounds, 0.2);
    expect(bbox).toBe("28.0000,8.0000,42.0000,22.0000");
  });

  it("clamps to coordinate limits (-180, -90, 180, 90)", () => {
    const mockBounds = {
      getSouth: () => -85,
      getNorth: () => 85,
      getWest: () => -175,
      getEast: () => 175,
    } as any;

    const bbox = computeBufferedBbox(mockBounds, 0.2);
    expect(bbox).toBe("-180.0000,-90.0000,180.0000,90.0000");
  });
});
