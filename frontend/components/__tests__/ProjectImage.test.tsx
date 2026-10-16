/**
 * components/__tests__/ProjectImage.test.tsx
 *
 * Tests for #1069 — the cover-photo fallback used by `ProjectCard` and
 * the map popup. jsdom never fires a real `error` event for `<img>`, so
 * we drive `onError` with fireEvent, which is what the browser would do
 * on a 404 / unreachable upload.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectCard from "@/components/ProjectCard";
import ProjectImage, {
  PROJECT_PLACEHOLDER_SRC,
} from "@/components/ProjectImage";
import type { ClimateProject } from "@/utils/types";

const mockProject: ClimateProject = {
  id: "proj-1",
  name: "Amazon Reforestation Initiative",
  description: "Restoring native tree cover across degraded rainforest land.",
  category: "Reforestation",
  location: "Brazil",
  walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
  goalXLM: "10000",
  raisedXLM: "2500",
  donorCount: 42,
  co2OffsetKg: 1200,
  co2_per_xlm: 0.48,
  status: "active",
  verified: true,
  onChainVerified: false,
  tags: ["trees", "carbon"],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

function cover(): HTMLImageElement {
  return screen.getByRole("img") as HTMLImageElement;
}

describe("ProjectImage", () => {
  it("renders the uploaded cover URL while it loads fine", () => {
    render(<ProjectImage src="https://files.example.com/cover.png" alt="Cover" />);
    expect(cover()).toHaveAttribute("src", "https://files.example.com/cover.png");
  });

  it("swaps in the branded placeholder when the cover fails to load", () => {
    render(<ProjectImage src="https://files.example.com/gone.png" alt="Cover" />);

    fireEvent.error(cover());

    expect(cover()).toHaveAttribute("src", PROJECT_PLACEHOLDER_SRC);
    // The project is still identifiable to screen readers.
    expect(cover()).toHaveAttribute("alt", "Cover");
  });

  it("does not retry in a loop when the placeholder itself fails", () => {
    render(<ProjectImage src="https://files.example.com/gone.png" alt="Cover" />);

    fireEvent.error(cover());
    fireEvent.error(cover());
    fireEvent.error(cover());

    expect(cover()).toHaveAttribute("src", PROJECT_PLACEHOLDER_SRC);
  });

  it("picks up a re-uploaded cover without a remount", () => {
    const { rerender } = render(
      <ProjectImage src="https://files.example.com/gone.png" alt="Cover" />,
    );
    fireEvent.error(cover());
    expect(cover()).toHaveAttribute("src", PROJECT_PLACEHOLDER_SRC);

    rerender(<ProjectImage src="https://files.example.com/fresh.png" alt="Cover" />);

    expect(cover()).toHaveAttribute("src", "https://files.example.com/fresh.png");
  });

  it("keeps the placeholder src stable across unrelated re-renders", () => {
    const { rerender } = render(
      <ProjectImage src="https://files.example.com/gone.png" alt="Cover" />,
    );
    fireEvent.error(cover());
    rerender(<ProjectImage src="https://files.example.com/gone.png" alt="Cover renamed" />);

    expect(cover()).toHaveAttribute("src", PROJECT_PLACEHOLDER_SRC);
  });
});

describe("ProjectCard cover integration (#1069)", () => {
  it("shows the placeholder instead of a broken icon when the upload 404s", () => {
    render(<ProjectCard project={{ ...mockProject, imageUrl: "https://bad.example/x.png" }} />);

    const img = screen.getByRole("img", { name: /amazon reforestation initiative/i });
    fireEvent.error(img);

    expect(img).toHaveAttribute("src", PROJECT_PLACEHOLDER_SRC);
  });

  it("renders no cover block at all when the project has no imageUrl", () => {
    render(<ProjectCard project={mockProject} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
