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
