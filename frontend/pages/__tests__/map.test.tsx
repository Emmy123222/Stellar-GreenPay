/**
 * pages/__tests__/map.test.tsx
 *
 * Tests for the /map page component.
 *
 * The Leaflet MapContainer requires a real DOM with canvas and resize APIs.
 * We mock react-leaflet entirely so the tests focus on:
 *   - rendering the page banner (title, subtitle, project count)
 *   - empty-state rendering when no projects are passed
 *   - the ProjectMap dynamic import is rendered (or its loading fallback)
 */
import { render, screen } from "@testing-library/react";
import type { ClimateProject } from "@/utils/types";

// ── Mock next/dynamic ─────────────────────────────────────────────────────────
// next/dynamic cannot resolve modules in jsdom; replace it with a simple
// pass-through that renders the component synchronously.
jest.mock("next/dynamic", () => {
  return function mockDynamic(
    importFn: () => Promise<{ default: React.ComponentType<{ projects: ClimateProject[] }> }>,
    options?: { loading?: () => JSX.Element }
  ) {
    // Return a component that renders the loading placeholder so the test
    // can verify the page skeleton without needing a real Leaflet canvas.
    return function DynamicStub({ projects }: { projects: ClimateProject[] }) {
      return (
        <div data-testid="project-map-stub" data-count={projects.length}>
          Map loaded with {projects.length} project(s)
        </div>
      );
    };
  };
});

// ── Mock useI18n ──────────────────────────────────────────────────────────────
jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "map.title":          "Project World Map",
        "map.subtitle":       "{count} active projects around the globe",
        "map.activeProjects": "active projects",
        "map.browseAll":      "Browse all projects",
        "map.noProjects":     "No active projects yet",
        "map.noProjectsDesc": "Check back soon — new projects are verified regularly.",
        "map.dataUpdated":    "Data as of {time}",
      };
      return translations[key] ?? key;
    },
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<ClimateProject> = {}): ClimateProject {
  return {
    id:           "proj-1",
    name:         "Amazon Reforestation",
    description:  "Restoring rainforest cover.",
    category:     "Reforestation",
    location:     "Brazil",
    walletAddress:"GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
    goalXLM:      "10000",
    raisedXLM:    "2500",
    donorCount:   42,
    co2OffsetKg:  1200,
    status:       "active",
    verified:     true,
    onChainVerified: false,
    tags:         ["trees"],
    createdAt:    "2025-01-01T00:00:00.000Z",
    updatedAt:    "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// We import MapPage AFTER the mocks are in place.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MapPage = require("@/pages/map").default;

describe("MapPage", () => {
  const FETCHED_AT = "2025-06-30T12:00:00.000Z";

  describe("with active projects", () => {
    const projects = [
      makeProject({ id: "proj-1", name: "Amazon Reforestation" }),
      makeProject({ id: "proj-2", name: "Kenya Solar Grid" }),
      makeProject({ id: "proj-3", name: "Coral Triangle Conservation" }),
    ];

    it("renders the page title", () => {
      render(<MapPage projects={projects} fetchedAt={FETCHED_AT} />);
      expect(screen.getByText("Project World Map")).toBeInTheDocument();
    });

    it("renders the project count in the subtitle", () => {
      render(<MapPage projects={projects} fetchedAt={FETCHED_AT} />);
      // Subtitle template has "{count} active projects around the globe"
      // The count appears in both the subtitle <p> and the badge <span>, so use getAllByText
      const matches = screen.getAllByText(/3 active projects/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("renders the active-projects count badge", () => {
      render(<MapPage projects={projects} fetchedAt={FETCHED_AT} />);
      // The badge <span> contains separate text nodes "3", " ", "active projects".
      // Use getAllByText since the count also appears in the subtitle.
      const matches = screen.getAllByText(/3\s*active projects/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("renders a Browse All link pointing to /projects", () => {
      render(<MapPage projects={projects} fetchedAt={FETCHED_AT} />);
      const browseLink = screen.getByRole("link", { name: /browse all/i });
      expect(browseLink).toHaveAttribute("href", "/projects");
    });

    it("passes the project list to the map component", () => {
      render(<MapPage projects={projects} fetchedAt={FETCHED_AT} />);
      const mapStub = screen.getByTestId("project-map-stub");
      expect(mapStub).toHaveAttribute("data-count", "3");
    });

    it("does not render the empty-state message", () => {
      render(<MapPage projects={projects} fetchedAt={FETCHED_AT} />);
      expect(screen.queryByText(/no active projects yet/i)).not.toBeInTheDocument();
    });
  });

  describe("with no projects (empty state)", () => {
    it("renders the empty-state heading", () => {
      render(<MapPage projects={[]} fetchedAt={FETCHED_AT} />);
      expect(screen.getByText(/no active projects yet/i)).toBeInTheDocument();
    });

    it("renders the empty-state description", () => {
      render(<MapPage projects={[]} fetchedAt={FETCHED_AT} />);
      expect(
        screen.getByText(/check back soon/i)
      ).toBeInTheDocument();
    });

    it("renders a Browse link in the empty state", () => {
      render(<MapPage projects={[]} fetchedAt={FETCHED_AT} />);
      const links = screen.getAllByRole("link", { name: /browse all/i });
      // At least one link exists (could be banner + empty state)
      expect(links.length).toBeGreaterThanOrEqual(1);
    });

    it("shows a zero count badge", () => {
      render(<MapPage projects={[]} fetchedAt={FETCHED_AT} />);
      const matches = screen.getAllByText(/0\s*active projects/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
