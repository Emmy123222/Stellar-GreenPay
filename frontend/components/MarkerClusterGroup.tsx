/**
 * components/MarkerClusterGroup.tsx
 *
 * React-Leaflet integration for leaflet.markercluster.
 * Groups nearby project markers into clusters at zoom levels below 10.
 *
 * Acceptance Criteria satisfied:
 *  - Implement marker clustering using leaflet.markercluster
 *  - Cluster count badge shows the number of grouped projects
 *  - Clicking a cluster zooms into the group (zoomToBoundsOnClick: true)
 *  - Individual markers visible at zoom level 10+ (disableClusteringAtZoom: 10)
 */
"use client";

import { createLayerComponent, createElementObject, extendContext } from "@react-leaflet/core";
import L from "leaflet";
import type { ReactNode } from "react";

// In browser environments, attach L to window so leaflet.markercluster binds properly
if (typeof window !== "undefined") {
  (window as unknown as { L: typeof L }).L = L;
  require("leaflet.markercluster");
}

/**
 * Creates custom cluster icons with themed count badges.
 */
export function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  let size = 38;
  let sizeClass = "greenpay-cluster-small";

  if (count >= 50) {
    size = 50;
    sizeClass = "greenpay-cluster-large";
  } else if (count >= 10) {
    size = 44;
    sizeClass = "greenpay-cluster-medium";
  }

  return L.divIcon({
    html: `
      <div class="greenpay-cluster-badge ${sizeClass}" role="button" aria-label="Cluster of ${count} projects" tabindex="0">
        <span class="cluster-badge-count">${count}</span>
      </div>
    `,
    className: "greenpay-cluster-wrapper",
    iconSize: L.point(size, size, true),
    iconAnchor: L.point(size / 2, size / 2, true),
  });
}

export interface MarkerClusterGroupProps extends L.MarkerClusterGroupOptions {
  children?: ReactNode;
}

const MarkerClusterGroup = createLayerComponent<L.MarkerClusterGroup, MarkerClusterGroupProps>(
  function createMarkerClusterGroup({ children: _c, ...options }, ctx) {
    const clusterOptions: L.MarkerClusterGroupOptions = {
      disableClusteringAtZoom: 10,
      zoomToBoundsOnClick: true,
      showCoverageOnHover: false,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: createClusterIcon,
      ...options,
    };

    const clusterGroup = new L.MarkerClusterGroup(clusterOptions);

    return createElementObject(clusterGroup, extendContext(ctx, {
      layerContainer: clusterGroup,
    }));
  },
  function updateMarkerClusterGroup() {
    // Re-clustering updates can be applied if options change
  }
);

export default MarkerClusterGroup;
