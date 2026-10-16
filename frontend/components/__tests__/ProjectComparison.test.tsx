import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectComparison from "../ProjectComparison";
import type { ClimateProject } from "@/utils/types";

const MOCK_PROJECTS: ClimateProject[] = [
  {
    id: "proj-1",
    name: "Amazon Reforestation",
    description: "Planting native trees in the Amazon rainforest.",
    category: "Reforestation",
    location: "Brazil",
    walletAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "50000",
    raisedXLM: "25000",
    donorCount: 120,
    co2OffsetKg: 100000,
    status: "active",
    verified: true,
    averageRating: 4.8,
    ratingCount: 15,
    tags: ["reforestation", "trees"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "proj-2",
    name: "Solar Energy Sahara",
    description: "Solar panels installation in desert regions.",
    category: "Solar Energy",
    location: "Morocco",
    walletAddress: "GBAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    goalXLM: "30000",
    raisedXLM: "15000",
    donorCount: 80,
    co2OffsetKg: 60000,
    status: "active",
    verified: false,
    averageRating: 0,
    ratingCount: 0,
    tags: ["solar", "clean-energy"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe("ProjectComparison", () => {
  const onCloseMock = jest.fn();
  const onRemoveProjectMock = jest.fn();
  const onAddProjectMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a semantic table with thead, tbody, and proper scope attributes", () => {
    render(
      <ProjectComparison
        projects={MOCK_PROJECTS}
        onClose={onCloseMock}
      />
    );

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();

    const columnHeaders = screen.getAllByRole("columnheader");
    // Column headers: Metric + each project
    expect(columnHeaders.length).toBe(3);
    expect(columnHeaders[0]).toHaveAttribute("scope", "col");
    expect(columnHeaders[1]).toHaveAttribute("scope", "col");
    expect(columnHeaders[2]).toHaveAttribute("scope", "col");

    const rowHeaders = screen.getAllByRole("rowheader");
    // 5 metric rows + 1 action row
    expect(rowHeaders.length).toBe(6);
    rowHeaders.forEach((header) => {
      expect(header).toHaveAttribute("scope", "row");
    });
  });

  it("provides accessible names and ARIA labels on all icon buttons and interactive elements", () => {
    render(
      <ProjectComparison
        projects={MOCK_PROJECTS}
        onClose={onCloseMock}
        onRemoveProject={onRemoveProjectMock}
        onAddProject={onAddProjectMock}
      />
    );

    // Remove buttons have descriptive accessible names per project
    expect(
      screen.getByRole("button", { name: "Remove Amazon Reforestation from comparison" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Solar Energy Sahara from comparison" })
    ).toBeInTheDocument();

    // Close and Share buttons have accessible names
    expect(screen.getByRole("button", { name: "Close comparison modal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share comparison URL" })).toBeInTheDocument();

    // Add project button
    expect(screen.getByRole("button", { name: "Add project to comparison" })).toBeInTheDocument();

    // Donate links have descriptive accessible names
    expect(screen.getByRole("link", { name: "Donate to Amazon Reforestation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Donate to Solar Energy Sahara" })).toBeInTheDocument();
  });

  it("supports keyboard navigation with Tab across interactive elements", async () => {
    const user = userEvent.setup();
    render(
      <ProjectComparison
        projects={MOCK_PROJECTS}
        onClose={onCloseMock}
        onAddProject={onAddProjectMock}
      />
    );

    // Tab through buttons in order
    await user.tab();
    expect(screen.getByRole("button", { name: "Add project to comparison" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Share comparison URL" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close comparison modal" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("region", { name: "Project comparison table" })).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Remove Amazon Reforestation from comparison" })
    ).toHaveFocus();
  });

  it("removes a project when the remove icon button is clicked and triggers onRemoveProject callback", () => {
    render(
      <ProjectComparison
        projects={MOCK_PROJECTS}
        onClose={onCloseMock}
        onRemoveProject={onRemoveProjectMock}
      />
    );

    const removeBtn = screen.getByRole("button", {
      name: "Remove Amazon Reforestation from comparison",
    });
    fireEvent.click(removeBtn);

    expect(onRemoveProjectMock).toHaveBeenCalledWith("proj-1");
    expect(screen.queryByText("Amazon Reforestation")).not.toBeInTheDocument();
    expect(screen.getByText("Solar Energy Sahara")).toBeInTheDocument();

    // Live region announces removal
    expect(screen.getByText("Amazon Reforestation removed from comparison")).toBeInTheDocument();
  });

  it("renders empty state when all projects are removed", () => {
    render(
      <ProjectComparison
        projects={[MOCK_PROJECTS[0]]}
        onClose={onCloseMock}
      />
    );

    const removeBtn = screen.getByRole("button", {
      name: "Remove Amazon Reforestation from comparison",
    });
    fireEvent.click(removeBtn);

    expect(screen.getByText("No projects to compare")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse projects to compare" })).toBeInTheDocument();
  });
});
