import { render } from "@testing-library/react";
import ProjectCard, { ProjectCardSkeleton } from "../ProjectCard";
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

describe("ProjectCard", () => {
  it("matches snapshot for an active, partially-funded project", () => {
    const { container } = render(<ProjectCard project={mockProject} />);
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot for a fully-funded project", () => {
    const funded: ClimateProject = { ...mockProject, raisedXLM: "10000" };
    const { container } = render(<ProjectCard project={funded} />);
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot for the loading skeleton", () => {
    const { container } = render(<ProjectCardSkeleton />);
    expect(container).toMatchSnapshot();
  });
});
