import { render, screen, fireEvent } from "@testing-library/react";
import ProjectAiSummary from "../ProjectAiSummary";
import type { ClimateProject } from "@/utils/types";

const mockProject: ClimateProject = {
  id: "proj-1",
  name: "Amazon Reforestation",
  description: "Restoring native tree cover.",
  category: "Reforestation",
  location: "Brazil",
  walletAddress: "GOWNER12345",
  goalXLM: "10000",
  raisedXLM: "5000",
  donorCount: 42,
  co2OffsetKg: 1200,
  status: "active",
  verified: true,
  tags: ["trees"],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
  aiSummary: "This project plants native trees in degraded zones.",
};

describe("ProjectAiSummary", () => {
  it("renders null if there is no summary and user is not owner", () => {
    const projectWithoutSummary = { ...mockProject, aiSummary: null };
    const { container } = render(
      <ProjectAiSummary
        project={projectWithoutSummary}
        publicKey="GVISITOR999"
        aiSummaryState="idle"
        aiSummaryError={null}
        onGenerateSummary={jest.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders AI summary card when summary exists", () => {
    render(
      <ProjectAiSummary
        project={mockProject}
        publicKey="GVISITOR999"
        aiSummaryState="idle"
        aiSummaryError={null}
        onGenerateSummary={jest.fn()}
      />
    );

    expect(screen.getByText("Impact at a glance")).toBeInTheDocument();
    expect(screen.getByText("AI Generated")).toBeInTheDocument();
    expect(screen.getByText("This project plants native trees in degraded zones.")).toBeInTheDocument();
  });

  it("shows refresh button for project owner and triggers callback", () => {
    const onGenerateSummary = jest.fn();
    render(
      <ProjectAiSummary
        project={mockProject}
        publicKey="GOWNER12345"
        aiSummaryState="idle"
        aiSummaryError={null}
        onGenerateSummary={onGenerateSummary}
      />
    );

    const refreshBtn = screen.getByRole("button", { name: /refresh summary/i });
    fireEvent.click(refreshBtn);
    expect(onGenerateSummary).toHaveBeenCalledTimes(1);
  });
});
