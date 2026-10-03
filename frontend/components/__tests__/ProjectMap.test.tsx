import React from "react";
import { render } from "@testing-library/react";
import ProjectMap from "../ProjectMap";
import type { ClimateProject } from "@/utils/types";

// Mock react-leaflet components for jsdom
jest.mock("react-leaflet", () => {
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="leaflet-map-container">{children}</div>
    ),
    TileLayer: () => <div data-testid="tile-layer" />,
    ZoomControl: () => <div data-testid="zoom-control" />,
    Marker: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="leaflet-marker">{children}</div>
    ),
    Popup: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="leaflet-popup">{children}</div>
    ),
  };
});

// Mock MarkerClusterGroup component
jest.mock("../MarkerClusterGroup", () => {
  return function MockMarkerClusterGroup({
    children,
    disableClusteringAtZoom,
    zoomToBoundsOnClick,
  }: {
    children: React.ReactNode;
    disableClusteringAtZoom: number;
    zoomToBoundsOnClick: boolean;
  }) {
    return (
      <div
        data-testid="marker-cluster-group"
        data-disable-clustering-zoom={disableClusteringAtZoom}
        data-zoom-to-bounds-on-click={String(zoomToBoundsOnClick)}
      >
        {children}
      </div>
    );
  };
});

function makeProject(id: string, name: string): ClimateProject {
  return {
    id,
    name,
    description: "A test project",
    category: "Reforestation",
    location: "Kenya",
    walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
    goalXLM: "10000",
    raisedXLM: "2500",
    donorCount: 15,
    co2OffsetKg: 500,
    status: "active",
    verified: true,
    onChainVerified: false,
    tags: ["trees"],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };
}

describe("ProjectMap with Marker Clustering", () => {
  it("renders MarkerClusterGroup with disableClusteringAtZoom=10 and zoomToBoundsOnClick=true", () => {
    const projects = [
      makeProject("p1", "Project 1"),
      makeProject("p2", "Project 2"),
      makeProject("p3", "Project 3"),
    ];

    const { getByTestId, getAllByTestId } = render(<ProjectMap projects={projects} />);

    expect(getByTestId("leaflet-map-container")).toBeInTheDocument();
    const clusterGroup = getByTestId("marker-cluster-group");
    expect(clusterGroup).toBeInTheDocument();
    expect(clusterGroup).toHaveAttribute("data-disable-clustering-zoom", "10");
    expect(clusterGroup).toHaveAttribute("data-zoom-to-bounds-on-click", "true");

    const markers = getAllByTestId("leaflet-marker");
    expect(markers).toHaveLength(3);
  });
});
