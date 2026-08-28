import { render, screen } from "@testing-library/react";
import ContributorTimeline from "../ContributorTimeline";
import type { ContributorPR } from "@/utils/types";

const samplePR: ContributorPR = {
  id: 1,
  number: 726,
  title: "Add contributor attribution page",
  htmlUrl: "https://github.com/Emmy123222/Stellar-GreenPay/pull/726",
  mergedAt: "2026-08-20T00:00:00Z",
  feature: "Contributors Page",
  author: {
    login: "octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    htmlUrl: "https://github.com/octocat",
  },
};

describe("ContributorTimeline", () => {
  it("shows an empty state when there are no merged pull requests", () => {
    render(<ContributorTimeline pullRequests={[]} />);

    expect(screen.getByText("No merged contributions yet")).toBeInTheDocument();
  });

  it("renders a merged pull request with its author, feature tag, and links", () => {
    render(<ContributorTimeline pullRequests={[samplePR]} />);

    const prLink = screen.getByRole("link", { name: samplePR.title });
    expect(prLink).toHaveAttribute("href", samplePR.htmlUrl);

    expect(screen.getByText("Contributors Page")).toBeInTheDocument();
    expect(screen.getByText(/@octocat/)).toBeInTheDocument();
    expect(screen.getByText(/#726/)).toBeInTheDocument();
    expect(screen.getByAltText("octocat's avatar")).toHaveAttribute(
      "src",
      samplePR.author.avatarUrl
    );
  });
});
