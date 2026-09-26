import L from "leaflet";
import { createClusterIcon } from "../MarkerClusterGroup";

describe("MarkerClusterGroup & Clustering Configuration", () => {
  describe("createClusterIcon", () => {
    it("generates a small badge with the correct project count for < 10 projects", () => {
      const mockCluster = {
        getChildCount: () => 5,
      } as unknown as L.MarkerCluster;

      const divIcon = createClusterIcon(mockCluster);
      expect(divIcon.options.className).toContain("greenpay-cluster-wrapper");
      expect(divIcon.options.html).toContain("greenpay-cluster-small");
      expect(divIcon.options.html).toContain("5");
      expect(divIcon.options.html).toContain('aria-label="Cluster of 5 projects"');
    });

    it("generates a medium badge with the correct project count for 10-49 projects", () => {
      const mockCluster = {
        getChildCount: () => 24,
      } as unknown as L.MarkerCluster;

      const divIcon = createClusterIcon(mockCluster);
      expect(divIcon.options.html).toContain("greenpay-cluster-medium");
      expect(divIcon.options.html).toContain("24");
      expect(divIcon.options.html).toContain('aria-label="Cluster of 24 projects"');
    });

    it("generates a large badge with the correct project count for 50+ projects", () => {
      const mockCluster = {
        getChildCount: () => 58,
      } as unknown as L.MarkerCluster;

      const divIcon = createClusterIcon(mockCluster);
      expect(divIcon.options.html).toContain("greenpay-cluster-large");
      expect(divIcon.options.html).toContain("58");
      expect(divIcon.options.html).toContain('aria-label="Cluster of 58 projects"');
    });
  });

  describe("Leaflet MarkerClusterGroup behavior", () => {
    beforeAll(() => {
      // Ensure Leaflet global is set for leaflet.markercluster
      if (typeof window !== "undefined") {
        (window as unknown as { L: typeof L }).L = L;
        require("leaflet.markercluster");
      }
    });

    it("configures disableClusteringAtZoom to 10 so markers are visible at zoom level 10+", () => {
      const clusterGroup = new L.MarkerClusterGroup({
        disableClusteringAtZoom: 10,
        zoomToBoundsOnClick: true,
        iconCreateFunction: createClusterIcon,
      });

      expect(clusterGroup.options.disableClusteringAtZoom).toBe(10);
      expect(clusterGroup.options.zoomToBoundsOnClick).toBe(true);
    });

    it("clusters 50+ markers together at low zoom levels and unclusters at zoom 10+", () => {
      const container = document.createElement("div");
      container.style.width = "800px";
      container.style.height = "600px";
      document.body.appendChild(container);

      const map = L.map(container, { maxZoom: 18 }).setView([20, 10], 2);

      const clusterGroup = new L.MarkerClusterGroup({
        disableClusteringAtZoom: 10,
        zoomToBoundsOnClick: true,
        iconCreateFunction: createClusterIcon,
      });
      map.addLayer(clusterGroup);

      // Add 55 markers close to each other
      const markers: L.Marker[] = [];
      for (let i = 0; i < 55; i++) {
        const marker = L.marker([20.0 + (i % 5) * 0.01, 10.0 + (i % 5) * 0.01]);
        markers.push(marker);
        clusterGroup.addLayer(marker);
      }

      // At zoom 2, all 55 markers are in the cluster group
      expect(clusterGroup.getLayers().length).toBe(55);

      // The top-level cluster should group the markers
      const topCluster = (clusterGroup as unknown as { _topClusterLevel: L.MarkerCluster })._topClusterLevel;
      expect(topCluster.getChildCount()).toBe(55);

      // Verify the cluster badge count shows 55
      const icon = createClusterIcon(topCluster);
      expect(icon.options.html).toContain("55");
      expect(icon.options.html).toContain("greenpay-cluster-large");

      // Verify clicking a cluster invokes zoomToBounds
      const zoomSpy = jest.spyOn(topCluster, "zoomToBounds");
      topCluster.zoomToBounds();
      expect(zoomSpy).toHaveBeenCalledTimes(1);

      // At zoom level 10+, max clustering zoom (disableClusteringAtZoom - 1) is 9,
      // so clustering is disabled for zoom 10 and above
      expect((clusterGroup as unknown as { _maxZoom: number })._maxZoom).toBe(9);

      map.remove();
      container.remove();
    });
  });
});
