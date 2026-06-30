/**
 * components/ProjectMapMarker.tsx
 *
 * A Leaflet Marker for a single ClimateProject rendered inside a
 * react-leaflet MapContainer.  Clicking the marker opens a Leaflet Popup
 * containing a mini project card with:
 *   - Project name, category icon, and location
 *   - Raised / Goal progress bar
 *   - Raised XLM amount
 *   - "Donate →" link that navigates to /donate?project=<id>
 *
 * This component MUST only be rendered client-side (Leaflet has no SSR
 * support).  The parent ProjectMap component handles the dynamic import
 * with ssr:false.
 */
import Link from "next/link";
import { Marker, Popup } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { ClimateProject } from "@/utils/types";
import { formatXLM, progressPercent, CATEGORY_ICONS } from "@/utils/format";

interface ProjectMapMarkerProps {
  project: ClimateProject;
  position: LatLngExpression;
}

export default function ProjectMapMarker({ project, position }: ProjectMapMarkerProps) {
  const pct = Math.min(progressPercent(project.raisedXLM, project.goalXLM), 100);
  const icon = CATEGORY_ICONS[project.category] ?? "🌿";

  return (
    <Marker position={position}>
      <Popup
        // Keep popup open on hover, close on click-outside
        closeButton={true}
        autoPan={true}
        className="greenpay-popup"
        minWidth={220}
        maxWidth={280}
      >
        {/* Mini project card ------------------------------------------------ */}
        <div className="flex flex-col gap-2 p-0.5" role="region" aria-label={`Project: ${project.name}`}>
          {/* Header: icon + name */}
          <div className="flex items-start gap-2">
            <span className="text-xl leading-none mt-0.5" aria-hidden="true">
              {icon}
            </span>
            <div className="min-w-0">
              <p className="font-display font-semibold text-forest-900 text-sm leading-snug line-clamp-2">
                {project.name}
              </p>
              <p className="text-xs text-forest-500 font-body mt-0.5 truncate">
                {project.category} · {project.location}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div
              className="h-1.5 w-full rounded-full bg-forest-100 overflow-hidden"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${pct.toFixed(0)}% funded`}
            >
              <div
                className="h-full rounded-full bg-forest-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-forest-600 font-body">
              <span className="font-semibold">{formatXLM(project.raisedXLM, 0)} raised</span>
              <span className="text-forest-400">{pct.toFixed(0)}%</span>
            </div>
          </div>

          {/* Donate link */}
          <Link
            href={`/donate?project=${project.id}`}
            className="mt-1 block w-full text-center text-xs font-body font-semibold text-white bg-forest-500 hover:bg-forest-600 active:bg-forest-700 rounded-lg py-1.5 px-3 transition-colors focus:outline-none focus:ring-2 focus:ring-forest-400 focus:ring-offset-1"
          >
            Donate →
          </Link>
        </div>
      </Popup>
    </Marker>
  );
}
