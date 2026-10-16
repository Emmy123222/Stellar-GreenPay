import { render, screen, fireEvent } from "@testing-library/react";
import ProjectHero from "../ProjectHero";
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
  onChainVerified: true,
  tags: ["trees"],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
  averageRating: 4.8,
  ratingCount: 15,
};

describe("ProjectHero", () => {
  const defaultProps = {
    project: mockProject,
    publicKey: "GPUBLICKEYMOCK1234567890",
    isComplete: false,
    isFollowing: false,
    followCount: 5,
    followLoading: false,
    onToggleFollow: jest.fn(),
    isInWishlist: false,
    onToggleWishlist: jest.fn(),
    shareState: "idle" as const,
    onTwitterShare: jest.fn(),
    onFacebookShare: jest.fn(),
    onCopyLink: jest.fn(),
  };

  it("renders project title, location, category, and on-chain verification badge", () => {
    render(<ProjectHero {...defaultProps} />);

    expect(screen.getByText("Amazon Reforestation")).toBeInTheDocument();
    expect(screen.getByText(/Brazil/)).toBeInTheDocument();
    expect(screen.getByText("Reforestation")).toBeInTheDocument();
    expect(screen.getByText(/On-chain verified/i)).toBeInTheDocument();
  });

  it("renders rating when averageRating > 0", () => {
    render(<ProjectHero {...defaultProps} />);

    expect(screen.getByText("4.8")).toBeInTheDocument();
    expect(screen.getByText("(15 reviews)")).toBeInTheDocument();
  });

  it("calls onToggleFollow when follow button is clicked", () => {
    render(<ProjectHero {...defaultProps} />);

    const followBtn = screen.getByRole("button", { name: /Follow \(5\)/i });
    fireEvent.click(followBtn);
    expect(defaultProps.onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it("shows Goal Reached celebration when isComplete is true", () => {
    render(<ProjectHero {...defaultProps} isComplete={true} />);

    expect(screen.getByText("🎉 Goal Reached!")).toBeInTheDocument();
    expect(screen.getByText(/✅ Fully Funded/i)).toBeInTheDocument();
  });
});
