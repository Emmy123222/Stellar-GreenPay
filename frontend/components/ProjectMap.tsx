/**
 * components/ProjectMap.tsx
 *
 * A full-viewport Leaflet world map that renders active climate project
 * markers. Each marker opens a mini popup card (see ProjectMapMarker).
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

import { useEffect } from "react";
import { MapContainer, TileLayer, ZoomControl } from "react-leaflet";
import L from "leaflet";
import type { ClimateProject } from "@/utils/types";
import { geocodeLocation, jitterCoords } from "@/utils/geocode";
import ProjectMapMarker from "./ProjectMapMarker";

// ── Fix Leaflet's broken default-icon asset resolution under webpack ───────────
// Leaflet resolves icon URLs at runtime from `L.Icon.Default.imagePath`; under
// webpack/Next.js the image files aren't shipped correctly.  We replace the
// default with a small inline SVG divIcon so nothing is imported from the
// leaflet assets directory.
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

// Patch the prototype so every Marker in this page gets the custom icon
// without having to pass it explicitly.
L.Marker.prototype.options.icon = DEFAULT_ICON;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectMapProps {
  /** Active climate projects to pin on the map. */
  projects: ClimateProject[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProjectMap({ projects }: ProjectMapProps) {
  // Leaflet needs the CSS — import it once at runtime (not at module level so
  // it doesn't run on the server via accidental imports).
  useEffect(() => {
    // Only import once; subsequent HMR reloads skip this because the link
    // element already exists in the document head.
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
      // Restrict panning so users can't scroll past the poles
      maxBounds={[[-90, -180], [90, 180]]}
      maxBoundsViscosity={1.0}
      aria-label="World map of active climate projects"
    >
      {/* OpenStreetMap tile layer — no API key needed */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
        maxZoom={19}
      />

      {/* Custom positioned zoom control (bottom-right avoids navbar overlap) */}
      <ZoomControl position="bottomright" />

      {/* Project markers */}
      {projects.map((project) => {
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
