import { render, screen, waitFor } from "@testing-library/react";
import LeaderboardTable from "../LeaderboardTable";

jest.mock("@/lib/api", () => ({
  fetchLeaderboard: jest.fn(),
}));

jest.mock("@/lib/priceContext", () => ({
  useXlmPrice: () => null,
}));

const { fetchLeaderboard } = jest.requireMock("@/lib/api");

describe("LeaderboardTable empty state", () => {
  beforeEach(() => {
    fetchLeaderboard.mockReset();
  });

  it("shows a friendly empty state with a link to browse projects when there are no donors", async () => {
    fetchLeaderboard.mockResolvedValue([]);

    render(<LeaderboardTable limit={50} period="all" />);

    await waitFor(() =>
      expect(screen.getByText(/no donations yet — be the first donor on the leaderboard!/i)).toBeInTheDocument()
    );

    const link = screen.getByRole("link", { name: /browse projects/i });
    expect(link).toHaveAttribute("href", "/projects");
  });
});

describe("LeaderboardTable populated state", () => {
  beforeEach(() => {
    fetchLeaderboard.mockReset();
  });

  it("renders donor avatar, display name, and links row to donor profile page", async () => {
    fetchLeaderboard.mockResolvedValue([
      {
        rank: 1,
        publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        displayName: "Alice Green",
        avatarUrl: "https://example.com/alice.png",
        totalDonatedXLM: "1000",
        totalCO2OffsetKg: "250",
        projectsSupported: 3,
        topBadge: "earth",
      },
      {
        rank: 2,
        publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        displayName: null,
        avatarUrl: null,
        totalDonatedXLM: "500",
        totalCO2OffsetKg: "100",
        projectsSupported: 1,
      },
    ]);

    render(<LeaderboardTable limit={50} period="all" />);

    await waitFor(() => {
      expect(screen.getByText("Alice Green")).toBeInTheDocument();
    });

    // Renders avatar image for Alice
    const avatarImg = screen.getByAltText("Alice Green");
    expect(avatarImg).toHaveAttribute("src", "https://example.com/alice.png");

    // Renders abbreviated address fallback for Bob
    expect(screen.getByText("GBBBBB...BBBBBB")).toBeInTheDocument();

    // Clicking donor row links to public donor profile page
    const aliceLink = screen.getByRole("link", { name: /alice green/i });
    expect(aliceLink).toHaveAttribute(
      "href",
      "/donors/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    );

    const bobLink = screen.getByRole("link", { name: /gbbbbb\.\.\.bbbbbb/i });
    expect(bobLink).toHaveAttribute(
      "href",
      "/donors/GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    );
  });
});
