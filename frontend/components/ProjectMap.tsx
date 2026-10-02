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

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { MapContainer, TileLayer, ZoomControl } from "react-leaflet";
import L from "leaflet";
import type { ClimateProject } from "@/utils/types";
import { geocodeLocation, jitterCoords } from "@/utils/geocode";
import ProjectMapMarker from "./ProjectMapMarker";
import MarkerClusterGroup from "./MarkerClusterGroup";

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
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const router = useRouter();

  // Leaflet needs the CSS — import it once at runtime (not at module level so
  // it doesn't run on the server via accidental imports).
  useEffect(() => {
    // Only import once; subsequent HMR reloads skip this because the link
    // element already exists in the document head.
    if (typeof document !== "undefined") {
      if (!document.head.querySelector('link[href*="leaflet@"]')) {
        const link = document.createElement("link");
        link.rel  = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      }

      if (!document.head.querySelector('link[href*="MarkerCluster"]')) {
        const clusterLink = document.createElement("link");
        clusterLink.rel = "stylesheet";
        clusterLink.href = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css";
        document.head.appendChild(clusterLink);

        const clusterDefaultLink = document.createElement("link");
        clusterDefaultLink.rel = "stylesheet";
        clusterDefaultLink.href = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css";
        document.head.appendChild(clusterDefaultLink);
      }
    }
  }, []);

  // Keyboard navigation for list view
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(Math.min(index + 1, projects.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(Math.max(index - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // Navigate to project detail
      router.push(`/projects/${projects[index].id}`);
    }
  };

  // List view component
  if (viewMode === 'list') {
    return (
      <div className="h-full w-full p-4 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold text-forest-900">Projects List</h2>
          <button
            onClick={() => setViewMode('map')}
            className="btn-primary text-sm py-2 px-4"
            aria-label="Switch to map view"
          >
            🗺️ View Map
          </button>
        </div>
        <div className="space-y-2">
          {projects.map((project, index) => (
            <div
              key={project.id}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => handleKeyDown(e, index)}
              onClick={() => window.location.href = `/projects/${project.id}`}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                focusedIndex === index
                  ? 'bg-forest-100 border-forest-500 ring-2 ring-forest-500'
                  : 'bg-white border-forest-200 hover:border-forest-400 hover:bg-forest-50'
              }`}
              aria-label={`View ${project.name} project details`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-forest-900">{project.name}</h3>
                  <p className="text-sm text-forest-600 mt-1">{project.location}</p>
                  <p className="text-xs text-muted-foreground mt-1">{project.category}</p>
                </div>
                <div className="text-right ml-4">
                  <p className="text-sm font-medium text-forest-700">
                    {project.raisedXLM || 0} XLM raised
                  </p>
                  <p className="text-xs text-forest-600">
                    {project.donorCount || 0} donors
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="absolute top-4 right-4 z-[1000]">
        <button
          onClick={() => setViewMode('list')}
          className="btn-primary text-sm py-2 px-4 shadow-lg"
          aria-label="Switch to list view"
        >
          📋 View as List
        </button>
      </div>
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

      {/* Clustered project markers (clusters below zoom 10, individual markers at zoom 10+) */}
      <MarkerClusterGroup
        disableClusteringAtZoom={10}
        zoomToBoundsOnClick={true}
      >
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
      </MarkerClusterGroup>
    </MapContainer>
    </>
  );
}
