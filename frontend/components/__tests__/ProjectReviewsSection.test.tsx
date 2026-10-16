import { render, screen, fireEvent } from "@testing-library/react";
import ProjectReviewsSection from "../ProjectReviewsSection";
import type { ProjectReview } from "@/utils/types";

const mockReviews: ProjectReview[] = [
  {
    donorAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST",
    rating: 5,
    review: "Amazing transparency and impact updates!",
    createdAt: "2025-01-01T00:00:00.000Z",
  },
];

describe("ProjectReviewsSection", () => {
  it("renders empty state when there are no reviews", () => {
    render(
      <ProjectReviewsSection
        reviews={[]}
        reviewsTotal={0}
        reviewsLoading={false}
        reviewsHasMore={false}
        loadingMoreReviews={false}
        onLoadMore={jest.fn()}
      />
    );

    expect(screen.getByText(/no reviews yet/i)).toBeInTheDocument();
  });

  it("renders review with stars and text", () => {
    render(
      <ProjectReviewsSection
        reviews={mockReviews}
        reviewsTotal={1}
        reviewsLoading={false}
        reviewsHasMore={false}
        loadingMoreReviews={false}
        averageRating={5}
        ratingCount={1}
        onLoadMore={jest.fn()}
      />
    );

    expect(screen.getByText("Donor Reviews")).toBeInTheDocument();
    expect(screen.getByText("5.0")).toBeInTheDocument();
    expect(screen.getByText("(1 review)")).toBeInTheDocument();
    expect(screen.getByText("Amazing transparency and impact updates!")).toBeInTheDocument();
  });

  it("renders Load more reviews button when reviewsHasMore is true", () => {
    const onLoadMore = jest.fn();
    render(
      <ProjectReviewsSection
        reviews={mockReviews}
        reviewsTotal={10}
        reviewsLoading={false}
        reviewsHasMore={true}
        loadingMoreReviews={false}
        onLoadMore={onLoadMore}
      />
    );

    const loadMoreBtn = screen.getByRole("button", { name: /load more reviews \(9 remaining\)/i });
    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
