import { render, screen } from "@testing-library/react";
import ProjectMilestones from "../ProjectMilestones";
import type { ProjectMilestone } from "@/utils/types";

const mockMilestones: ProjectMilestone[] = [
  {
    id: "m-1",
    projectId: "proj-1",
    title: "Phase 1: Seedlings",
    percentage: 25,
    reachedAt: "2025-01-01T00:00:00.000Z",
    transactionHash: "tx123456",
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "m-2",
    projectId: "proj-1",
    title: "Phase 2: Planting",
    percentage: 50,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
];

describe("ProjectMilestones", () => {
  it("renders null if milestones array is empty", () => {
    const { container } = render(
      <ProjectMilestones milestones={[]} raisedXLM="1000" goalXLM="10000" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders milestones, percentage circles, and proof link", () => {
    render(
      <ProjectMilestones
        milestones={mockMilestones}
        raisedXLM="3000"
        goalXLM="10000"
      />
    );

    expect(screen.getByText("Project Milestones")).toBeInTheDocument();
    expect(screen.getByText("Phase 1: Seedlings")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Proof ↗")).toBeInTheDocument();
    expect(screen.getByText("Phase 2: Planting")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
