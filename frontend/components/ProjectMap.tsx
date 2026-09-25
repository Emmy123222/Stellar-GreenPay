/**
 * components/ProjectMap.tsx
 *
 * A full-viewport Leaflet world map that renders active climate project
 * markers. Each marker opens a mini popup card (see ProjectMapMarker).
 *
 * Viewport-aware loading: only fetches and renders projects within the
 * current map bounds + 20% buffer, debounced at 300ms on pan/zoom.
 *
 * ⚠ Leaflet has no server-side rendering support — this component MUST be
 *   imported with `{ ssr: false }` via next/dynamic:
 *
 *   ```ts
 *   const ProjectMap = dynamic(() => import('@/components/ProjectMap'), { ssr: false });
 *   ```
 *
 * Tile provider: OpenStreetMap (no API key required, free to use under ODbL).
 * Icons: Leaflet's built-in SVG divIcon so we avoid broken default-icon paths
 * that occur when Leaflet's image assets are bundled through webpack.
 */
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { MapContainer, TileLayer, ZoomControl, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { ClimateProject } from "@/utils/types";
import { geocodeLocation, jitterCoords } from "@/utils/geocode";
import { fetchGeoProjects } from "@/lib/api";
import ProjectMapMarker from "./ProjectMapMarker";

// ── Fix Leaflet's broken default-icon asset resolution under webpack ───────────
const DEFAULT_ICON = L.divIcon({
  className: "",
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36" aria-hidden="true">
      <path
        d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 24 12 24S24 20.5 24 12C24 5.373 18.627 0 12 0z"
        fill="#227239"
        stroke="#ffffff"
        stroke-width="1.5"
      />
      <circle cx="12" cy="12" r="5" fill="#ffffff" opacity="0.9"/>
    </svg>
  `,
  iconSize:   [24, 36],
  iconAnchor: [12, 36],
  popupAnchor:[0,  -38],
});

L.Marker.prototype.options.icon = DEFAULT_ICON;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectMapProps {
  /** Active climate projects to pin on the map. */
  projects?: ClimateProject[];
}

/**
 * Calculates a bounding box string (minLng,minLat,maxLng,maxLat) with an optional buffer
 * (default 20%).
 */
export function computeBufferedBbox(bounds: L.LatLngBounds, bufferFraction = 0.2): string {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const latBuffer = (north - south) * bufferFraction;
  const lngBuffer = (east - west) * bufferFraction;
  const minLat = Math.max(-90, south - latBuffer);
  const maxLat = Math.min(90, north + latBuffer);
  const minLng = Math.max(-180, west - lngBuffer);
  const maxLng = Math.min(180, east + lngBuffer);
  return `${minLng.toFixed(4)},${minLat.toFixed(4)},${maxLng.toFixed(4)},${maxLat.toFixed(4)}`;
}

/**
 * Inner component to hook into Leaflet map events for viewport awareness.
 */
function ViewportHandler({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds()),
  });

  useEffect(() => {
    onBoundsChange(map.getBounds());
  }, [map, onBoundsChange]);

  return null;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProjectMap({ projects = [] }: ProjectMapProps) {
  const [visibleProjects, setVisibleProjects] = useState<ClimateProject[]>(projects);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync visible projects when the prop changes using the render-time
  // "adjusting state when a prop changes" pattern recommended by the React
  // docs, rather than useEffect (which triggers the react-hooks/set-state-in-effect lint).
  const [prevProjects, setPrevProjects] = useState(projects);
  if (projects !== prevProjects) {
    setPrevProjects(projects);
    setVisibleProjects(projects);
  }

  const handleBoundsChange = useCallback((bounds: L.LatLngBounds) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const bbox = computeBufferedBbox(bounds, 0.2);
        const geoProjects = await fetchGeoProjects(bbox);
        if (Array.isArray(geoProjects)) {
          setVisibleProjects(geoProjects);
        }
      } catch (err) {
        console.error("Failed to fetch geo projects in bounds:", err);
      }
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined" &&
        !document.head.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement("link");
      link.rel  = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  }, []);

  return (
    <MapContainer
      center={[20, 10]}
      zoom={2}
      minZoom={2}
      maxZoom={18}
      scrollWheelZoom={true}
      zoomControl={false}
      className="h-full w-full"
      maxBounds={[[-90, -180], [90, 180]]}
      maxBoundsViscosity={1.0}
      aria-label="World map of active climate projects"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
        maxZoom={19}
      />

      <ZoomControl position="bottomright" />

      {/* Viewport listener with 300ms debounce */}
      <ViewportHandler onBoundsChange={handleBoundsChange} />

      {/* Viewport-aware project markers */}
      {visibleProjects.map((project) => {
        const base     = geocodeLocation(project.location);
        const position = jitterCoords(base, project.id);
        return (
          <ProjectMapMarker
            key={project.id}
            project={project}
            position={[position.lat, position.lng]}
          />
        );
      })}
    </MapContainer>
  );
}
