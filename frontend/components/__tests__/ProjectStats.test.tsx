import { render, screen, fireEvent } from "@testing-library/react";
import ProjectStats from "../ProjectStats";
import type { ClimateProject } from "@/utils/types";

const mockProject: ClimateProject = {
  id: "proj-1",
  name: "Amazon Reforestation",
  description: "Restoring native tree cover.",
  category: "Reforestation",
  location: "Brazil",
  walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
  goalXLM: "10000",
  raisedXLM: "5000",
  donorCount: 42,
  co2OffsetKg: 1200,
  status: "active",
  verified: true,
  tags: ["trees"],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

describe("ProjectStats", () => {
  it("renders stat cards for donors, CO2 offset, and goal", () => {
    render(
      <ProjectStats
        project={mockProject}
        copyState="idle"
        onCopyWallet={jest.fn()}
      />
    );

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Donors")).toBeInTheDocument();
    expect(screen.getByText(/1.2k kg CO₂/i)).toBeInTheDocument();
    expect(screen.getByText("CO₂ Offset")).toBeInTheDocument();
    expect(screen.getByText(/10,000(\.00)? XLM/i)).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
  });

  it("calls onCopyWallet when copy button is clicked", () => {
    const onCopyWallet = jest.fn();
    render(
      <ProjectStats
        project={mockProject}
        copyState="idle"
        onCopyWallet={onCopyWallet}
      />
    );

    const copyBtn = screen.getByRole("button", { name: /copy wallet address/i });
    fireEvent.click(copyBtn);
    expect(onCopyWallet).toHaveBeenCalledTimes(1);
  });

  it("displays Copied! status when copyState is copied", () => {
    render(
      <ProjectStats
        project={mockProject}
        copyState="copied"
        onCopyWallet={jest.fn()}
      />
    );

    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });
});
