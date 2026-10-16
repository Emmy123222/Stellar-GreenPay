/**
 * components/__tests__/ProjectMapMarker.test.tsx
 *
 * #1069 also asks for the fallback in the map popup. Leaflet needs a real
 * map instance, so — like `__tests__/pages/map.test.tsx` — we stub
 * `react-leaflet` and assert on the popup contents.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClimateProject } from "@/utils/types";
import { PROJECT_PLACEHOLDER_SRC } from "@/components/ProjectImage";

// Render <Popup>'s children inline; a real Leaflet popup is portalled
// into the map pane, which we don't have under jsdom.
jest.mock("react-leaflet", () => ({
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import ProjectMapMarker from "@/components/ProjectMapMarker";

function makeProject(overrides: Partial<ClimateProject> = {}): ClimateProject {
  return {
    id: "proj-1",
    name: "Coastal Mangrove Restore",
    description: "Replanting mangroves along eroding coastline.",
    category: "Reforestation",
    location: "Indonesia",
    walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
    goalXLM: "5000",
    raisedXLM: "1200",
    donorCount: 12,
    co2OffsetKg: 400,
    status: "active",
    verified: true,
    onChainVerified: false,
    tags: ["mangrove"],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function renderMarker(project: ClimateProject) {
  return render(<ProjectMapMarker project={project} position={[1, 2]} />);
}

describe("ProjectMapMarker popup cover image", () => {
  it("renders the cover photo when the project has one", () => {
    renderMarker(makeProject({ imageUrl: "https://files.example.com/mangrove.png" }));

    expect(screen.getByRole("img", { name: /coastal mangrove restore/i })).toHaveAttribute(
      "src",
      "https://files.example.com/mangrove.png",
    );
  });

  it("falls back to the branded placeholder when the cover fails to load", () => {
    renderMarker(makeProject({ imageUrl: "https://bad.example/mangrove.png" }));

    const img = screen.getByRole("img", { name: /coastal mangrove restore/i });
    fireEvent.error(img);

    expect(img).toHaveAttribute("src", PROJECT_PLACEHOLDER_SRC);
  });

  it("omits the cover block entirely for projects without an upload", () => {
    renderMarker(makeProject());

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // The rest of the mini card is unaffected.
    expect(screen.getByText(/Coastal Mangrove Restore/)).toBeInTheDocument();
  });

  it("keeps the donate link pointing at the project", () => {
    renderMarker(makeProject({ id: "proj-42" }));

    expect(screen.getByRole("link", { name: /Donate/ })).toHaveAttribute(
      "href",
      "/donate?project=proj-42",
    );
  });
});
