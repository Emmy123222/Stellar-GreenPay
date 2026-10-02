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

  it("sorts unsorted timeline events chronologically (ascending by timestamp)", () => {
    const prNewest: ContributorPR = {
      ...samplePR,
      id: 3,
      number: 730,
      title: "Newest Feature",
      mergedAt: "2026-09-01T12:00:00Z",
    };
    const prOldest: ContributorPR = {
      ...samplePR,
      id: 1,
      number: 700,
      title: "Oldest Feature",
      mergedAt: "2026-01-10T12:00:00Z",
    };
    const prMiddle: ContributorPR = {
      ...samplePR,
      id: 2,
      number: 715,
      title: "Middle Feature",
      mergedAt: "2026-05-15T12:00:00Z",
    };

    render(
      <ContributorTimeline pullRequests={[prNewest, prOldest, prMiddle]} />
    );

    const links = screen.getAllByRole("link", { name: /Feature/ });
    const titles = links.map((link) => link.textContent);

    expect(titles).toEqual([
      "Oldest Feature",
      "Middle Feature",
      "Newest Feature",
    ]);
  });

  it("shows relative time as a tooltip over the absolute date", () => {
    render(<ContributorTimeline pullRequests={[samplePR]} />);

    const dateSpan = screen.getByTitle(/ago/i);
    expect(dateSpan).toBeInTheDocument();
    expect(dateSpan).toHaveTextContent(/Merged/);
  });
});
